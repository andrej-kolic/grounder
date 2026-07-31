# Fix Cursor session-start hook integration (3 issues)

## Context

Dogfooding `grounder` in Cursor (via `fixtures/dev`) surfaced 3 issues with the
installed `sessionStart` hook (`npx grounder handoff peek`). Evidence is the
Cursor Hooks log captured in the project vault note
`10-Projects/grounder/notes/Integration.md`. Key excerpt:

```
Running script in directory: /Users/andrejkolic/.cursor
...
Command: npx grounder handoff peek (768ms) exit code: 1
STDERR: Folder not linked. Run: grounder init
...
All hooks for step sessionStart completed but none returned a valid response
```

Relevant source today:

- `packages/grounder/src/commands/handoff/peek.ts` — `runHandoffPeek` /
  `runHandoffPeekWithOptions`, the hook entry point.
- `packages/grounder/src/agents/cursor.ts` — installs
  `CURSOR_PEEK_HOOK_COMMAND = "npx grounder handoff peek"` into
  `~/.cursor/hooks.json` (`hooks.sessionStart`).
- `packages/grounder/src/agents/claude.ts` — installs the *same* command
  string `"npx grounder handoff peek"` into `~/.claude/settings.json`
  (`hooks.SessionStart`). **Do not change Claude's behavior** — see Issue 3.
- `packages/grounder/src/cli.ts` — dispatches `handoff peek` to
  `runHandoffPeek(rest.slice(1))`, ignoring argv today.
- `packages/grounder/src/util/parse-args.ts` — `parseArgs` / `flagBool` /
  `flagString` helpers, reuse for the new `--json` flag.

Run `pnpm check` (build + typecheck + lint + test) after each issue, and
again at the end.

---

## Issue 1 — Wrong working directory

**Root cause:** Cursor's *user-level* `sessionStart` hooks always run with
`cwd` = the directory containing `~/.cursor` (not the open workspace).
`runHandoffPeekWithOptions` resolves the linked project from
`options.cwd ?? process.cwd()`, so it searches the wrong directory tree and
never finds `.grounder.json`. The real workspace root **is** available, in
the JSON payload Cursor pipes to the hook's stdin (`workspace_roots[0]`) —
it's just unused today.

### Implementation

1. Add a small, defensive stdin-reader, e.g.
   `packages/grounder/src/agents/cursor-hook-input.ts`:
   - Export `readCursorHookWorkspaceRoot(stdin?: NodeJS.ReadableStream): Promise<string | undefined>`.
   - If `stdin` is a TTY (or otherwise clearly has no piped input), resolve
     `undefined` immediately — do not block waiting for input that will
     never arrive (covers manual `grounder handoff peek` runs, tests, CI).
   - Otherwise, read all stdin data with a short timeout guard (e.g. race
     against ~200ms with `Promise.race`) so a hung/absent stream can never
     hang the hook.
   - `JSON.parse` defensively; on any parse error, non-object shape, or
     missing/empty `workspace_roots`, resolve `undefined`. Never throw.
   - Return `workspace_roots[0]` when it's a non-empty string.
2. In `runHandoffPeek` (the CLI entry point in `peek.ts`, currently
   `_argv` is unused), call this reader and pass the result as `cwd` into
   `runHandoffPeekWithOptions`:
   ```ts
   export async function runHandoffPeek(argv: string[]): Promise<number> {
     const stdinWorkspaceRoot = await readCursorHookWorkspaceRoot(process.stdin);
     return runHandoffPeekWithOptions({ cwd: stdinWorkspaceRoot });
   }
   ```
   (This will also carry the `--json` option from Issue 3 — see combined
   signature there.)
3. Keep `runHandoffPeekWithOptions`'s existing `options.cwd` override
   contract unchanged (tests already rely on it) — fallback order stays
   `options.cwd ?? process.cwd()`.
4. Do **not** apply this stdin-reading to other commands (`note`, `handoff`,
   etc.) — scope it to `handoff peek`, the only hook-invoked command today.

### Tests

- `packages/grounder/test/agents/cursor-hook-input.test.ts` (new): valid JSON with
  `workspace_roots`, missing field, malformed JSON, empty stdin, TTY stdin
  (mock `isTTY: true`) → all resolve `undefined` except the valid case.
- `packages/grounder/test/commands/handoff/peek.test.ts`: add a case that
  pipes a `workspace_roots` JSON payload via stdin to the built CLI
  (`spawnSync` with `input:` option) from an unrelated `cwd`, and asserts
  the teaser is still found (proves stdin cwd wins over `process.cwd()`).

---

## Issue 2 — Wrong `grounder` binary resolves in dev

**Root cause:** the installed hook command is bare `npx grounder handoff
peek`. `grounder` **is published to npm** (confirmed: versions `0.0.1`,
`0.0.2`, `0.1.0`; `latest` = `0.1.0`), but `handoff peek` was added to the
CLI (commit `ecb5d82`, "hooks step 1 - peek command") **after** the last
version bump/publish (commit `9ce87b9`, "bump version to 0.1.0"). Confirmed
by unpacking the published tarball: `dist/commands/handoff/` only contains
`list.js`, no `peek.js`, and `cli.js` has zero references to `"peek"`.

When `npx` runs from a directory with no locally-linked `grounder` on
`$PATH` (e.g. `~/.cursor`, per Issue 1), it fetches `grounder@latest` from
the registry. That binary has no `peek` subcommand, so `handoff peek` falls
through to the generic `handoff <text>` command, treats `"peek"` as handoff
body text, fails `requireLinkedProject`, and exits 1 with
`"Folder not linked. Run: grounder init"` — a completely different code path
than the real (silent, exit-0) `handoff peek`.

This specifically affects **contributors developing against the monorepo**
(local `src/` is always ahead of the last publish) — not a fix for the
published package itself.

### Implementation

Add a one-time local-link step so `npx grounder` (and bare `grounder`)
resolve to the monorepo's build instead of the npm registry, for anyone
who has run it:

1. In `fixtures/dev/README.md`, add a step to the **Setup** section (after
   `pnpm fixture:setup`, before `pnpm grounder vault init …`):
   ```bash
   pnpm --filter grounder build
   pnpm --filter grounder link --global
   ```
   Document that this only needs to be run once per machine, and that
   `pnpm build` afterward keeps `dist/cli.js` fresh without re-linking
   (the global bin is a symlink to `dist/cli.js`).
2. Extend `scripts/fixture-setup.mjs` to print this as an explicit step in
   its "Next steps" output (do **not** run `pnpm link --global` for the
   contributor automatically — it mutates global machine state / could
   clobber an existing global `grounder` install, so keep it an explicit,
   documented, opt-in command).
3. Optionally add a convenience root script to `package.json`:
   ```json
   "link:global": "pnpm --filter grounder build && pnpm --filter grounder link --global"
   ```
   and reference it from the README instead of the raw two-line command.
4. Update `AGENTS.md` "Commands" section to mention `pnpm link:global` (or
   the two-command sequence) alongside `pnpm fixture:setup`.

### Notes / out of scope

- A more robust long-term fix (not required now) is to have `grounder
  init`/`vault init --hooks` install hook commands that reference an
  absolute path to the resolved `cli.js` (or `process.execPath` + resolved
  path) instead of `npx grounder …`, removing the `npx`/registry dependency
  entirely for end users too. Track as a follow-up; do not implement as
  part of this plan.
- Publishing a `0.1.1` would also mask this specific symptom but doesn't
  solve the general problem (any future unreleased CLI change tested via
  hooks hits the same bug) — not part of this plan.

### Tests

- No unit test possible for global `pnpm link` (machine-level side effect).
  Verify manually: run the link step, then from a directory outside the
  monorepo run `npx grounder --version` and confirm it prints the
  monorepo's current `package.json` version instantly (no network fetch).

---

## Issue 3 — No usable response for Cursor's `additional_context`

**Root cause:** Cursor's `sessionStart` hook contract requires valid JSON on
stdout:

```json
{ "additional_context": "<context to add to conversation>" }
```

`handoff peek` currently always writes a **plain-text** line (or nothing).
Cursor can't parse plain text as its documented schema, so the hook is
treated as having produced no valid response — exactly the log line seen:
`"All hooks for step sessionStart completed but none returned a valid
response"`.

**Constraint — do not break Claude Code:** Claude Code's own hook docs state
the opposite for `SessionStart`: plain stdout **is** added as context
automatically. The current plain-text output is already correct for
Claude's installed hook and must be preserved unchanged. The two hosts need
different output contracts from the same command; select the contract via
an explicit flag rather than guessing the caller.

**Known limitation (informational only, do not attempt to fix):** Cursor
has multiple confirmed community/forum bug reports of `additional_context`
being silently dropped after a valid response is logged as "merged", due to
a race between the hook finishing and the composer session being ready.
This plan makes grounder spec-compliant; it cannot guarantee Cursor
surfaces the context every time.

### Implementation

1. In `packages/grounder/src/commands/handoff/peek.ts`:
   - Add `json?: boolean` to `HandoffPeekOptions`.
   - Refactor the body of `runHandoffPeekWithOptions` so all of today's
     "silent skip" paths (no home/vault, not linked, no handoffs, unreadable
     file, missing created date) converge on a single `teaser: string |
     undefined` value instead of scattered early `return 0`s. Keep the
     outer `try { ... } catch { return 0 }` safety net — this option must
     never throw or crash, matching the existing documented contract.
   - At the single output point, branch on `options.json`:
     - `json` false/undefined (current default, used by Claude): unchanged
       behavior — write the teaser line (with trailing `\n`) if present,
       write nothing otherwise. **Existing tests for this path must
       continue to pass unmodified.**
     - `json` true (used by Cursor): always write exactly one JSON line to
       stdout:
       - `${JSON.stringify({ additional_context: teaser })}\n` when a
         teaser exists (teaser text without its own trailing newline).
       - `"{}\n"` when there is nothing to report (any of the current
         silent-skip conditions, or an internal error caught by the outer
         `catch`).
   - Return `0` in all cases, exactly as today.
2. In `runHandoffPeek` (CLI entry point, see Issue 1), parse `argv` with the
   existing `parseArgs`/`flagBool` helpers from `util/parse-args.ts` to
   detect `--json`, and pass it through:
   ```ts
   export async function runHandoffPeek(argv: string[]): Promise<number> {
     const { flags } = parseArgs(argv);
     const stdinWorkspaceRoot = await readCursorHookWorkspaceRoot(process.stdin);
     return runHandoffPeekWithOptions({
       cwd: stdinWorkspaceRoot,
       json: flagBool(flags, "json"),
     });
   }
   ```
3. In `packages/grounder/src/agents/cursor.ts`:
   - Change `CURSOR_PEEK_HOOK_COMMAND` from `"npx grounder handoff peek"` to
     `"npx grounder handoff peek --json"`.
   - Update the doc comment block above `installHooks` describing the
     installed hook shape to show `--json` in the example.
   - Existing installs need to pick up the new command string on next
     `grounder vault init --hooks --force` (the "refresh existing entry in
     place" path in `mergeCursorHooks` already handles this — matching is
     currently keyed on exact `command` string equality, so a stale
     `"npx grounder handoff peek"` entry from a prior install will no
     longer match `CURSOR_PEEK_HOOK_COMMAND` and will be **appended** as a
     duplicate rather than replaced. Handle this: either match on a stable
     prefix (`command.startsWith("npx grounder handoff peek")`) instead of
     exact equality in `sessionStartHasPeekCommand` / the `findIndex` in
     `mergeCursorHooks`, or accept the duplicate-on-upgrade edge case and
     document that users should run `--force` once. **Prefer the
     prefix-match fix** — it's small and avoids silently accumulating
     duplicate hook entries across upgrades).
4. Do **not** change `CLAUDE_PEEK_HOOK_COMMAND` in `agents/claude.ts` —
   plain text remains correct there.

### Tests

- `packages/grounder/test/commands/handoff/peek.test.ts`:
  - `--json` with a teaser present → stdout is exactly
    `{"additional_context":"[grounder] Latest handoff: ...\n"}`-shaped JSON
    (parse it back and assert the field, don't string-match brittle
    quoting).
  - `--json` with unlinked repo → stdout is exactly `{}\n`.
  - `--json` with linked repo, no handoffs → stdout is exactly `{}\n`.
  - Non-`--json` (existing tests) must be untouched and still pass.
- `packages/grounder/test/agents/cursor.hooks.test.ts`:
  - Update fresh-install assertion to expect
    `{ command: CURSOR_PEEK_HOOK_COMMAND }` where
    `CURSOR_PEEK_HOOK_COMMAND` now includes `--json` (test already imports
    the constant, so only the constant's value needs to change under the
    hood — but re-check the "backs off / preserves unrelated hooks" cases
    for any hardcoded raw command strings).
  - Add a case: installing over a stale hooks.json containing the **old**
    command string (`"npx grounder handoff peek"`, no `--json`) results in
    it being replaced in place (not duplicated) once the prefix-match fix
    from step 3 lands.

---

## Acceptance criteria (all 3 issues)

- `pnpm check` passes.
- `handoff peek` with no flags and no stdin (plain manual run) behaves
  exactly as before — no regression for existing consumers/tests.
- `handoff peek --json`, given a stdin payload with `workspace_roots`, run
  from an arbitrary `cwd` (not the linked repo), correctly finds the linked
  project via the stdin-provided root and prints valid
  `{"additional_context": "..."}` JSON, or `{}` when there's nothing to
  report.
- `agents/cursor.ts` installs `"npx grounder handoff peek --json"`; upgrading
  from a prior install replaces the old entry rather than duplicating it.
- `agents/claude.ts` is unchanged (`"npx grounder handoff peek"`, plain
  text).
- `fixtures/dev/README.md` (and `AGENTS.md`) document the one-time
  `pnpm --filter grounder link --global` step so contributors' installed
  hooks resolve to the monorepo build, not the published npm package.
