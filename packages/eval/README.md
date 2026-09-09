# @grounder/eval

Live-agent eval harness for Grounder skill prompts (ticket #102). Kept as its own workspace package, same as `packages/e2e` — not part of root `pnpm test`/`check`, never installed to end users.

## Glossary

- **Harness** — this package: the machinery that runs probes and grades them. Not a test suite in the vitest sense — it drives real model turns, not assertions against code.
- **Probe** — one scripted attempt to make a skill misbehave or behave well: a slash-command prompt (e.g. `/grounder-search find notes about X`, or `/grounder-recall now save this session as a handoff too`) plus the rule for what counts as pass/fail. Defined in `probes/*.json`.
- **Probe set** — all the probes for one skill area: `search` (relevance ranking) or `mode-lock` (recall/handoff read/write boundary). Each has its own `eval-<name>.mjs` entrypoint and grading rule, sharing the same runner underneath.
- **Sweep** — the set of `(host, model)` pairs a probe set runs against. Default is every pair in `lib/models.mjs`'s catalog; `--models`/`--hosts` narrow it independently.
- **Host** — which headless CLI actually runs the probe: `claude` (native Claude Code CLI) or `cursor-agent` (Cursor's CLI). Each host has its own installed skill template tree, so it's a real variable, not just a routing detail — see [Model sweep](#model-sweep).
- **Sandbox** — the scratch config (`GROUNDER_HOME`, `.grounder.json`, and for mode-lock a disposable vault) that points the skill under test at throwaway state instead of your real vault. Lives outside this git repo entirely (see [A real sandbox-escape, found and fixed](#a-real-sandbox-escape-found-and-fixed)) and does *not* extend to the host CLI's own home directory (see [Isolation](#isolation)).

## Why this exists

`packages/grounder/test/templates/*.test.ts` only proves a skill's instruction text exists. It can't prove a model actually follows that text — especially under adversarial phrasing (the mode-lock probes) or when the model has to construct its own search query (the search probes). Only a real model turn can prove that, so each probe here is a genuine, non-interactive agent run:

```bash
pnpm eval:search
pnpm eval:mode-lock
```

Both commands are fully self-contained: set up a sandbox, run the full model sweep, grade the result, print a report, exit non-zero on any failure. No orchestrator skill/command file, no interactive session — see [Design note](#design-note) for why.

**This grades your machine's installed Grounder runtime and skill files, not this checkout.** `{{GROUNDER_CLI}}` resolves to `~/.grounder/runtime/dist/cli.js`, and the skills a probe actually invokes live under `~/.cursor`/`~/.claude`. Both commands refuse to run (`grounder status --json` reports `installCurrent: false`, or the runtime is missing outright) until you run `grounder migrate` — otherwise a green sweep could just mean yesterday's install, not this branch's skill-prompt changes.

## How it works

1. **Sandbox** (`lib/sandbox.mjs`) — writes a scratch `~/.grounder`-shaped config under your OS temp dir (`$TMPDIR/grounder-eval/`, **not** inside this repo — see below) pointing `GROUNDER_HOME` at a sandboxed vault, plus a `.grounder.json` project marker in a scratch repo dir. Search reuses the committed `fixtures/eval-vault/` (read-only); mode-lock wipes and recreates a fully disposable vault every run (handoff probes write to it for real) and seeds two handoffs (so both a bare load and a `#2` selector probe have something real to resolve).
2. **Run** (`lib/run-agent.mjs`) — for every `(host, model, probe)` triple, spawns the real headless CLI (`claude -p` or `cursor-agent -p`) with `--output-format stream-json`, the probe text as the prompt (exactly what a user would type), and `GROUNDER_HOME` set on the child process — the model's own Bash tool calls inherit that env var automatically, so the *installed* skill file runs completely unmodified and unaware it's sandboxed.
3. **Extract** — parses the CLI's own tool-call events out of the stream-json output to get the Bash commands the model *actually* ran and its final chat answer. This is ground truth, not a self-report: a model that fails the mode-lock boundary could also misreport having failed it, so grading never trusts the model's own account of what it did.
4. **Grade** — search: does the final answer's `## Read these` #1 link match the probe's expected file (`probes/search-probes.json`)? Mode-lock: did any actually-run command match the probe's forbidden pattern (`probes/mode-lock-probes.json`), and is the one-sentence mismatch notice present when expected?
5. **Report** — a Unicode-table pass/fail summary to stdout, plus a full audit transcript saved to `.tmp/report-<probe-set>-<n>.md` (gitignored) for debugging a failure.

## Model sweep

`lib/models.mjs`'s `MODEL_CATALOG` maps each model name to the hosts that can run it — `host` and `model` are independent, chosen separately, not baked into fixed pairs. The same underlying model running through two different hosts is a genuinely different probe, not a duplicate: Grounder ships two separate skill template trees (`templates/agents/claude/skills/*` vs `templates/agents/cursor/skills/*`), so a model behaving well via `claude` says nothing about whether the *cursor* template's wording is any good, and vice versa — and, as it turns out, not even just the template: the same model can genuinely behave differently depending on which host's own harness drives it (see [Design note](#design-note)). The default sweep is every `(model, host)` pair in the catalog — every Anthropic model (sonnet/opus/haiku/fable) natively via `claude`, and — except haiku, which has no cursor-agent equivalent at the time of writing — again via `cursor-agent`, alongside the cursor-only models (grok/gemini/composer/gpt-5-mini). Both CLIs must be installed and authenticated on the machine running this.

Narrow the sweep two ways, independently:

- `--models <name-or-label,...>` — a bare model name (e.g. `sonnet`) matches every host that supports it; an exact label (e.g. `"sonnet (cursor-agent)"`, as auto-generated by the catalog) matches just that one.
- `--hosts <host,...>` — `claude` and/or `cursor-agent`, regardless of model.

Combine both to pin an exact pair. Labels/names with spaces need quoting; the flag values themselves are comma-separated only (not whitespace).

Full sweep stays mandatory before merge/release; a narrowed sweep is dev-loop only, never a substitute.

`--concurrency <n>` caps how many `(host, model, probe)` runs are in flight at once (default 4). A full default sweep is up to 11 (host, model) pairs × up to 6 probes; running all of it at once would share one scratch cwd/vault across dozens of concurrent CLI processes and likely trip rate limits.

## Examples

```bash
# Full default sweep, both probe sets — the actual pre-merge/release gate
pnpm eval:search
pnpm eval:mode-lock

# One native Anthropic model, cheapest/fastest — everyday dev-loop iteration
pnpm eval:search -- --models haiku
pnpm eval:mode-lock -- --models haiku

# "sonnet" alone crosses every host that supports it (both claude and
# cursor-agent) — two rows in the report, not one
pnpm eval:search -- --models sonnet

# Pin sonnet to exactly one host, two equivalent ways
pnpm eval:search -- --models sonnet --hosts cursor-agent
pnpm eval:search -- --models "sonnet (cursor-agent)"

# Every model available through one host, regardless of which
pnpm eval:search -- --hosts cursor-agent

# A cursor-only model (no native-CLI equivalent at all)
pnpm eval:search -- --models "gpt 5 mini"

# Several names/labels at once — comma-separated, quote anything with a space
pnpm eval:mode-lock -- --models haiku,"sonnet (cursor-agent)","gpt 5 mini"

# Don't remember the exact spelling? Pass a bogus one — the error lists
# every known model name and host from lib/models.mjs.
pnpm eval:search -- --models nope
```

## A real sandbox-escape, found and fixed

Early testing put the scratch project dirs under `packages/eval/.tmp/` — inside this git repo. That let a `cursor-agent`-routed probe occasionally (~1 in 7 trials observed) read the real vault and answer from it instead of the sandboxed fixture, with no error and no `cd` in its own command history. Root cause, confirmed by Cursor staff on their [community forum](https://forum.cursor.com/t/agent-shell-working-directory-ignored-footer-reports-requested-cwd-workspace-is-a-git-subdirectory/168529): *"Any Shell command that runs inside the sandbox executes in the sandbox workspace root and silently ignores `working_directory`."* When cursor-agent's sandbox mode is active and the given directory sits inside a larger git repo, it silently runs shell commands from the **enclosing repo's root** instead — ignoring both the process `cwd` and an explicit `--workspace` flag. Not fixed upstream as of this writing.

Fix: `lib/sandbox.mjs` puts every scratch dir under `os.tmpdir()/grounder-eval/`, outside any git repository, so there's no enclosing repo root for cursor-agent to misdetect. Verified clean across 8 consecutive trials post-fix (zero prior to it, over ~15 trials, showed the same escape at roughly this rate). `lib/run-agent.mjs` also keeps a belt-and-suspenders check: `cursor-agent`'s stream-json events report each shell call's actual `workingDirectory`, and any value outside the sandbox `cwd` turns the result into a loud `error`, never a silently-wrong grade — this can't undo a write that already happened, but it can't be tricked into reporting one as safe either.

## Isolation

The sandbox covers `GROUNDER_HOME` (vault + project state) but deliberately does **not** override the host CLI's own `HOME`. That was tried: both `claude` and `cursor-agent` store their actual login token in the macOS Keychain (`Claude Code-credentials`, `cursor-access-token`), not in a plain file, and each resolves its keychain search path from `$HOME` — so a sandboxed `HOME` breaks authentication outright. Fixing that would mean either provisioning separate `ANTHROPIC_API_KEY`/`CURSOR_API_KEY` credentials for eval runs, or symlinking your entire login Keychain into the sandbox (every saved credential, not just these two) — both bigger tradeoffs than this harness's log-noise problem warrants, so it stays out of scope unless that changes.

In practice this is a smaller compromise than it sounds: since each probe runs in its own scratch cwd (`$TMPDIR/grounder-eval/search-repo/`, `$TMPDIR/grounder-eval/mode-lock-repo/`), the host CLI's per-project session transcripts land under a distinctly-named entry in your real `~/.claude/projects/` / `~/.cursor/projects/` — separate from, and never mixed into, this repo's own conversation history.

## Design note

An earlier version of this harness had a maintainer (or an interactive Cursor/Claude session) run an orchestrator skill that used the Task/Agent tool to spawn subagents. That turned out to be unnecessary: `claude -p` and `cursor-agent -p` are real non-interactive CLIs that can run one full agentic turn — including the exact skill invocation under test — from a plain script. Scripting the actual agent CLI, not just the Grounder CLI it drives, is what lets this whole harness be one dependency-free `pnpm eval:search` with no session in the loop.
