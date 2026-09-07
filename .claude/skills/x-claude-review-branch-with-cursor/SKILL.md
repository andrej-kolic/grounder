---
name: x-claude-review-branch-with-cursor
description: Loop an independent Cursor CLI review against Claude verify-and-fix passes on the current branch, alternating reviewer perspective each round. Runs inline in this session — no subagents, no auto-commit.
disable-model-invocation: true
---

Automates the manual "review in Cursor, paste into Claude, fix, repeat" cycle. Cursor's `agent` CLI reviews (read-only), Claude verifies each finding against the real code and applies confirmed fixes — alternating each round so Claude never rubber-stamps its own prior fix.

**Everything below runs as direct tool calls in this session — Bash/Read/Grep/Edit. Never spawn an `Agent`/`Task` subagent.** Subagent spin-up reloads a cold system prompt and throws away this session's cached context — the expensive part this skill exists to avoid.

## Arguments

Parse from `ARGUMENTS` (all optional):
- `--rounds N` — round cap, default **3**. Measured, not a guessed plateau (see calibration table) — round 4+ is untested, don't assume 3 is a ceiling either.
- `--base <branch>` — diff base, default `main`.
- `--model <name>` — Cursor model, default `cursor-grok-4.6-high-fast`. **Never `auto`** — it can route to a Claude variant under the hood and defeat the point of an independent reviewer. Round-cap behavior differs by model — check the calibration table before switching.
- `--scope incremental|full` — round 2+ diff scope, default `incremental`. See Step 1. Not a settled default — switch to `full` if `incremental` looks like it's missing things.

### Round-cap calibration by model (update as more models get tested)

Finding count per round, same branch, same starting baseline — real dogfooding data, not a general benchmark. **Raw counts, not new-finding counts** — repeats of already-settled findings can dominate a round (one run saw repeats reach 78% of a round). Log new-CONFIRMED-per-round in new rows, not just the raw count.

| Model | Rounds tested | Findings per round | Notes |
|---|---|---|---|
| `cursor-grok-4.6-high-fast` (default) | 3 | 8 → 11 → 6 | No plateau at round 3 — it caught a real gap in round 2's own fix. Treat round 3 as a floor, not a ceiling. |
| `gpt-5.3-codex-fast` | 2 | 8 → 4 | Tapered faster, but round 2 still found a real confirmed bug at the cap. Round 3 untested. |
| `composer-2.5-fast` | 3 | 12 → 13 → 9 | Same non-monotonic shape as Grok. Highest raw count and highest false-positive rate of the three — but also caught a real bug the other two missed. |
| any other model | 0 | untested | No data — don't invent a number. Add a row with the real curve once run. |

**Don't recommend running a second model on top.** This skill's design — pin a non-`auto` model, verify every finding against real code — already matches what the literature on multi-model review endorses; a second model mostly adds false positives unless independently verified the same way, which is just running this loop twice.

## Setup (once)

1. Confirm the CLI is ready: `agent status`. If not logged in, tell the user to run `agent login` and stop.
2. Determine repo root and current branch (`git rev-parse --show-toplevel`, `git branch --show-current`). Refuse to run on `main`/the base branch itself.
3. Confirm the log destination is ignored: `git check-ignore .tmp/review-loop/`. If not ignored, warn the user and ask before proceeding — don't write untracked review logs into a repo that isn't set up for it.
4. Log file: `.tmp/review-loop/<branch-slug>.log` (`/` → `-` in the branch name). Create the dir if missing. Append-only, plain text, terse lines — an audit trail, not a report:
   ```
   === round 1 · <ISO timestamp> · scope=<diff description> ===
   agent usage: in=<N> out=<N> cacheRead=<N>
   FOUND file.ts:42 [correctness] one-line summary
   VERIFY file.ts:42 CONFIRMED — one-line reason
   FIX    file.ts:42 applied
   FOUND other.ts:10 [simplification] one-line summary
   VERIFY other.ts:10 REJECTED — one-line reason
   FOUND third.ts:5 [efficiency] one-line summary
   VERIFY third.ts:5 SKIPPED — matches round 1's REJECTED verdict, no new evidence
   FOUND fourth.ts:88 [correctness] one-line summary
   VERIFY fourth.ts:88 UNTESTED — matches the code's own assumption, needs live UI testing to settle
   FOUND fifth.ts:20 [correctness] one-line summary
   VERIFY fifth.ts:20 CONFIRMED-DECLINED — real, but out of scope for an automated fix (needs a design decision)
   BUILD/TEST round 1: pnpm check green
   ```

## Loop (up to `--rounds` times)

**Step 1 — compute this round's scope.**
- Round 1: `mergeBase=$(git merge-base <base> HEAD)`; changed files = `git diff --name-only "$mergeBase"` (includes uncommitted working-tree changes automatically).
- Round 2+, `--scope incremental` (default): restrict to files *this session edited* during the previous round's fix step: `git diff --name-only "$mergeBase" -- <those files>`.
- Round 2+, `--scope full`: same as round 1 — full file list, no path restriction.
- If the resulting file list is empty:
  - Round 2+, `--scope incremental`, and the previous round applied zero fixes (every finding was REJECTED/UNTESTED/CONFIRMED-DECLINED) → stop, reason **"no fixes applied last round — nothing left to re-scope incrementally"** (report this distinctly — it means nothing got resolved, not that the review came back clean).
  - Otherwise (genuinely empty diff) → stop, reason "nothing to review."
  - Either way, go to Reporting.
- Round 2+ only: build this round's **exclusion list** — every finding logged REJECTED, UNTESTED, or CONFIRMED-DECLINED in an earlier round this run whose file is in this round's list, as `file — symbol/substance — verdict: one-line reason`. (Round 1: skip, nothing settled yet.)

**Step 2 — invoke Cursor (read-only).**
```bash
agent -p --trust --mode plan --output-format json --model <model> --workspace <repo-root> \
  "Review the following files for correctness bugs, reuse/simplification opportunities, and efficiency issues, focused on what changed relative to the '<base>' branch (run git diff yourself against <base> if you need the exact hunks — don't just review the whole file unscoped): <file list>. Output ONLY a JSON array (findings may still include a short lead-in sentence before it, that's fine, just make sure the array itself is well-formed) where each item has: file, line, category (correctness|simplification|efficiency), severity (high|medium|low), summary. Empty array if none found."
```
Round 2+, if this round's exclusion list is non-empty, append to the prompt: `" Prior verdicts from earlier rounds on these files (still open to challenge with real new evidence, not a gag order — only re-raise one if you have a genuinely new angle): <exclusion list>."`

Never add `--force`/`--yolo`. `--mode plan` guarantees Cursor can't touch files — the reason Claude is the only one allowed to edit in this loop.

**Step 3 — extract findings.**
The CLI's JSON envelope wraps the answer in a `result` string that can still contain prose despite the instruction above. Take the substring from the first `[` to the last `]` inside `result`, `JSON.parse` it.
- Parse failure → log `PARSE_FAILED round N`, **stop the loop**, report to the user as "couldn't determine" — never silently treat a parse failure as zero findings.
- Log the round's `usage` object (input/output/cache tokens) — the loop's own running cost, surfaced at the end.

**Step 4 — verify each finding (targeted, not exhaustive).**
Match against this round's exclusion list on **file + symbol/substance, not file:line** — line numbers shift after every fix, so exact file:line matching misses the repeats it exists to catch. Heuristic, not guaranteed — when genuinely unsure, treat as new and verify fresh.

- Matches an exclusion-list entry, and Cursor's write-up adds nothing beyond it → **skip.** Log `VERIFY <file> <symbol/substance> SKIPPED — matches round N's <REJECTED|UNTESTED|CONFIRMED-DECLINED> verdict, no new evidence`. Track how many rounds it's recurred this way (feeds Reporting; not a stop condition on its own, see Step 6).
- Matches, but Cursor raises something genuinely new (a different angle, an unconsidered case) → verify fresh. The exclusion list is a challengeable prior verdict, not a gag order.
- No match → `Read` the flagged line ± a small window first. If the claim depends on code elsewhere (a shared helper, a caller, reachability), follow it there — a targeted `Read`/`Grep` in another file to settle a real claim is expected, not a scope violation. The constraint is "don't dump whole files or explore speculatively," not "never leave the flagged file."

Decide one of three verdicts, each with a one-line reason:
- **CONFIRMED** — code reading settles it, the bug/opportunity is real.
- **REJECTED** — code reading settles it, the claim doesn't hold up.
- **UNTESTED** — matches what the code appears to do, but settling it needs live/runtime behavior reading code can't reach (UI interaction, timing, etc). Don't force CONFIRMED/REJECTED — say so plainly.

Log all three outcomes — REJECTED and UNTESTED matter for the recurrence check below just as much as CONFIRMED.

**Step 5 — fix confirmed findings.**
`Edit` each CONFIRMED finding directly in the working tree. Track which files got touched (feeds round N+1's `incremental` scope). **Never commit or push inside this loop** — the user reviews the cumulative diff when the loop finishes.

Not every CONFIRMED finding has to be fixed here — if it's genuinely out of scope for an automated pass (needs a design decision, touches an unrelated subsystem, risk outweighs the finding), log it `CONFIRMED-DECLINED` with a one-line reason instead of editing; it joins the exclusion list. Default is still to fix it — don't reach for this just because a fix is inconvenient.

**Step 5b — build/test gate.** Skip if zero findings were fixed this round. Otherwise run this repo's build+test entrypoint (`pnpm check` per `AGENTS.md`, or the equivalent elsewhere). On failure: feed the failure back, retry the fix (bounded to 2 retries, 3 attempts total). Still red → **stop the loop now**, flag the failure in Reporting. Only proceed to Step 6 once green.

**Step 6 — check stopping conditions, in order:**
1. Zero findings this round → converged, stop (success).
2. A finding at the same file + symbol/substance (not file:line) as something CONFIRMED+fixed the *previous* round reappears → stop after applying this round's fixes, flag explicitly as unresolved/disputed (a fix that didn't take, or a real disagreement — either way needs a human look). Doesn't apply to CONFIRMED-DECLINED reappearing — it was never fixed, so recurrence is expected, not an alarm; tracked in Reporting instead.
3. This round and the previous round both had zero *new* CONFIRMED findings (an exclusion-list match doesn't count as new) → converged, stop. Evaluable from round 2 on. Two consecutive rounds, not one — a single flat/zero round can still precede a real find the next round.
4. Round cap reached → stop.
- None of the above → next round.

A repeatedly-declined finding (Step 4's SKIPPED case) is **deliberately not a stop condition** — forcing a stop over one standing disagreement would penalize an otherwise-productive round. Track and report it instead (see Reporting) — don't drop it, and don't halt on it alone.

## Reporting (always, on any stop)

Tell the user, plainly:
- Rounds run, and why the loop stopped (converged / two-consecutive-zero-new / recurrence / build-test failure / no-fixes-last-round / cap reached / parse failure).
- Count confirmed+fixed vs. rejected vs. confirmed-but-declined, with one-line reasons for rejected and declined (so the user can sanity-check Claude's own verify calls, not just Cursor's).
- **UNTESTED findings, listed by name** — need a person to run the app and check.
- **CONFIRMED-DECLINED findings, listed by name with reason** — real but deliberately left unfixed; a person decides whether to act.
- Any recurrence flag, named plainly — don't bury it.
- **Any finding that recurred after being declined/UNTESTED, named as a standing disagreement** — e.g. "Cursor raised X in N rounds, declined every time: <reason>" — separate from the confirmed/rejected tally, worth a second opinion.
- Build/test gate result each round it ran (green, or the failure that stopped the loop).
- Cumulative Cursor-side token usage summed from logged `usage` objects, and the log file path.
- Explicit reminder: nothing was committed — review the diff before committing.
