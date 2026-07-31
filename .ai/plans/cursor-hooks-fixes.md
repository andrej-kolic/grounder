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
- `packages/grounder/src/agents/hook-runtime.ts` — materializes this
  package's `dist/` at `~/.grounder/runtime/dist/` (symlink for a durable
  source, copy for an ephemeral `npx` cache) and builds the canonical
  `node <runtime cli.js> handoff peek` hook command. See Issue 2.
- `packages/grounder/src/agents/cursor.ts` — installs
  `cursorPeekHookCommand()` (home-runtime, not `npx`) into
  `~/.cursor/hooks.json` (`hooks.sessionStart`).
- `packages/grounder/src/agents/claude.ts` — installs
  `claudePeekHookCommand()` (home-runtime, not `npx`) into
  `~/.claude/settings.json` (`hooks.SessionStart`). **Do not change Claude's
  output contract** — see Issue 3.
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

**Root cause:** the installed hook command was bare `npx grounder handoff
peek`. `grounder` **is published to npm** (confirmed: versions `0.0.1`,
`0.0.2`, `0.1.0`; `latest` = `0.1.0`), but `handoff peek` was added to the
CLI (commit `ecb5d82`, "hooks step 1 - peek command") **after** the last
version bump/publish (commit `9ce87b9`, "bump version to 0.1.0"). Confirmed
by unpacking the published tarball: `dist/commands/handoff/` only contains
`list.js`, no `peek.js`, and `cli.js` has zero references to `"peek"`.

`npx` fetches `grounder@latest` from the registry unless a package is
actually **installed** (global install, or a project dependency — it does
**not** consult global `pnpm link`/`pnpm add -g`, confirmed by testing:
`pnpm --filter grounder add -g .` leaves `npx grounder --version` printing
the stale registry version). That binary has no `peek` subcommand, so
`handoff peek` falls through to the generic `handoff <text>` command,
treats `"peek"` as handoff body text, fails `requireLinkedProject`, and
exits 1 with `"Folder not linked. Run: grounder init"` — a completely
different code path than the real (silent, exit-0) `handoff peek`.

This affects **contributors developing against the monorepo** (local `src/`
is always ahead of the last publish) and, more generally, **any end user**
whose hook was installed via bare `npx` — upgrading `grounder` never
changes what the hook actually runs.

### Design

Stop invoking `npx`/`grounder` from the hook config at all. Instead,
`vault init --hooks` materializes a private copy of the CLI at
`~/.grounder/runtime/dist/` and points the hook straight at it:
`process.execPath` + `~/.grounder/runtime/dist/cli.js` + `handoff peek`.
No PATH lookup, no npx, no registry fetch at hook time — for any host
(Cursor's `~/.cursor`, Claude's arbitrary cwd) or Node version.

How it's materialized depends on where `grounder` is running **from** when
`vault init --hooks` is invoked (`packages/grounder/src/agents/hook-runtime.ts`):

- **Durable source** — running from a monorepo checkout (`pnpm grounder …`
  → `node packages/grounder/dist/cli.js`) or a real install (`npm i -g
  grounder` / `pnpm add -g grounder` / project devDependency). These live
  at a path that persists and gets overwritten in place on
  rebuild/upgrade. → **Symlink** `~/.grounder/runtime/dist` straight to
  that source's `dist/`. `pnpm build`, or upgrading the global install,
  changes what the symlink resolves to immediately — the hook picks up new
  code with **zero re-run of `vault init` ever needed**. This is the
  primary fix for dogfooding (`fixtures/dev/`) and for any real install.
- **Ephemeral source** — bare `npx grounder …` with no install. Each
  invocation resolves to an immutable, version-keyed npx cache directory
  that npm can evict or replace with a *different* version at any time —
  symlinking to it would be actively wrong. → **Copy** `dist/` instead.
  Staying current requires re-running `grounder vault init <vault> --hooks`
  after upgrading (no `--force` needed — see staleness check below); this
  is an inherent limitation of using `npx` with nothing installed to back a
  persistent hook, not something to engineer around. Every other tool with
  install-time shims (husky, pre-commit) has the equivalent limitation for
  their zero-install invocation path.

Detection (`isEphemeralSource`): best-effort — is the source package root
inside `os.tmpdir()`, or does its path look like an `npx`/`pnpm dlx` cache
dir (`_npx`, `.npm/_npx`, `pnpm-dlx-*`)? Anything else counts as durable.

Idempotency / staleness (`isHookRuntimeStale`, checked by both adapters'
`installHooks` before touching anything):
- Symlink mode: stale iff `~/.grounder/runtime/dist` isn't currently a
  symlink resolving (`realpath`) to the running source's `dist/` — a
  cheap comparison with **no staleness window** (a matching symlink is
  always current, since there's no copy to go stale).
- Copy mode: stale iff the runtime's `manifest.json` is missing/unreadable
  or its recorded `version` differs from the source `package.json`
  version.

No mtime polling, no version checks, no re-exec **inside** `handoff peek`
itself — that logic only runs as part of `vault init --hooks`, which stays
an explicit, idempotent, already-documented command (matches how
husky/pre-commit shims work). Session hooks stay fast and side-effect-free.

Legacy migration: `isGrounderPeekHookCommand()` recognizes both the new
runtime-path command and the old bare `npx grounder handoff peek`, so an
existing install upgrades in place (no `--force`, no duplicate entries)
the next time `vault init --hooks` runs.

### Implementation

1. New `packages/grounder/src/agents/hook-runtime.ts`:
   - `grounderRuntimeDir` / `runtimeCliPath` / `runtimeManifestPath` (paths).
   - `shellQuote` — POSIX-safe single-quoting for embedding paths in a
     shell `command` string (Cursor/Claude run hooks via a shell).
   - `peekHookCommand(homeDir?, extraArgs?)` → the canonical command string.
   - `isGrounderPeekHookCommand(command)` → matches runtime-path or legacy
     `npx` form.
   - `isHookRuntimeStale(homeDir?, packageRoot?)` → see staleness rules
     above. `packageRoot` defaults to the currently running package;
     override only in tests.
   - `installHookRuntime({ homeDir?, packageRoot? })` → symlinks or copies
     per `isEphemeralSource`, writes `manifest.json` (`{ mode, version,
     nodePath, sourcePackageRoot, installedAt }`), returns
     `{ cliPath, status, mode }`. Always replaces whatever's currently at
     the destination (handles copy↔symlink transitions cleanly — `rm` on a
     symlink removes the link, never the target's contents).
2. `cursor.ts` / `claude.ts`:
   - `cursorPeekHookCommand()` / `claudePeekHookCommand()` replace the old
     `*_PEEK_HOOK_COMMAND` string constants, delegating to
     `peekHookCommand`.
   - `installHooks` calls `installHookRuntime` (after the up-to-date gate)
     and uses `isGrounderPeekHookCommand` for idempotent find/replace
     instead of exact string equality — so a legacy `npx` entry migrates
     in place rather than duplicating.
   - Skip only when the canonical command is present **and**
     `isHookRuntimeStale()` is false; otherwise refresh (covers first
     install, legacy migration, and picking up an upgrade — all without
     `--force`).
3. `vault/init.ts`: calls `installHookRuntime` once up front (for shared
   status output — printed once as `grounder runtime …`, not duplicated
   per agent) before per-agent `install`/`installHooks`.
4. Docs (`AGENTS.md`, package README, `fixtures/dev/README.md`): describe
   the runtime, and recommend a real install (global or devDependency) —
   not bare `npx` — as the way to set up hooks if you want upgrades to
   apply with zero extra steps. Bare `npx` remains fully supported for
   everything else (slash commands, one-off setup); it just keeps the
   "re-run `vault init --hooks` to update" limitation described above.

### Notes / out of scope

- Publishing a `0.1.1` would mask today's specific symptom but not the
  general problem (any future unreleased CLI change tested via hooks hits
  the same bug) — not part of this plan.
- No attempt to make ephemeral `npx` sources auto-update — see Design.

### Tests

- `test/agents/hook-runtime.test.ts`: `installHookRuntime` symlinks for the
  real package checkout (durable) and copies for a fake package root under
  `os.tmpdir()` (ephemeral); overwrites on re-install; transitions
  copy→symlink cleanly. `isHookRuntimeStale` true when never installed,
  when a symlink resolves to a different source, when a copy's version no
  longer matches, or when the manifest is missing/unreadable; false right
  after a matching install.
- `test/agents/cursor.hooks.test.ts` / `claude.hooks.test.ts` — fresh
  install uses the runtime command (no `npx`) and materializes the
  runtime; skip when up to date; migrate legacy `npx` without `--force`;
  idempotent; malformed host JSON unchanged.
- Manual check (symlink tracks a rebuild with zero re-run) isn't practical
  to unit test meaningfully — verify by hand: run `vault init --hooks`,
  append a marker to `packages/grounder/dist/cli.js`, and confirm
  `~/.grounder/runtime/dist/cli.js` shows the marker immediately (it's a
  symlink to the same file).

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
   - Pass `["--json"]` as `extraArgs` to `peekHookCommand`/`cursorPeekHookCommand`
     (already supports this — see Issue 2) instead of the bare command, so the
     installed hook becomes `... handoff peek --json`.
   - Update the doc comment block above `installHooks` describing the
     installed hook shape to show `--json` in the example.
   - No extra migration work needed: `isGrounderPeekHookCommand` already
     matches on the runtime path + `handoff peek` regardless of trailing
     flags (see Issue 2), so a stale entry without `--json` is replaced in
     place, not duplicated.
4. Do **not** change `claudePeekHookCommand()` in `agents/claude.ts` —
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
    `{ command: cursorPeekHookCommand(home, ["--json"]) }` (test already
    imports the helper, so only the call site needs the extra arg).
  - Add a case: installing over a stale hooks.json containing the command
    **without** `--json` results in it being replaced in place (not
    duplicated) — already covered by `isGrounderPeekHookCommand` matching
    on trailing-flag-agnostic prefix, confirm with a test.

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
- `agents/cursor.ts` installs the home-runtime command with `--json`
  (`cursorPeekHookCommand(homeDir, ["--json"])`, never `npx`); upgrading
  from a prior install (with or without `--json`) replaces the old entry
  rather than duplicating it.
- `agents/claude.ts` installs the home-runtime command with plain-text
  output (unchanged output contract).
- Neither hook depends on `npx`, a global install, or the npm registry at
  hook-run time — `~/.grounder/runtime/dist/cli.js` is invoked directly.
- `fixtures/dev/README.md` (and `AGENTS.md`, package README) document that
  `vault init --hooks` symlinks the runtime to the monorepo checkout for
  contributors (`pnpm build` alone keeps hooks current, no re-run needed),
  and that a real install (not bare `npx`) gets end users the same
  zero-re-run behavior.
