# `@grounder/e2e`

Private workspace package of real end-to-end smoke tests for the `grounder` CLI. Unlike `packages/grounder/test/` (vitest, calls the internal functions in-process), each `test/*.test.mjs` here spawns the real built `dist/cli.js` against an isolated `GROUNDER_HOME`/vault temp dir — so it also catches wiring bugs the in-process suite can't (flag parsing, env resolution, real file I/O, actual exit codes). It's vitest too, just its own package with its own config — kept out of `pnpm test`/`pnpm check` (see [Usage](#usage)) because these spawn real CLI processes and are slower.

**Not published to npm.**

## Usage

```bash
pnpm build               # from repo root — these tests run the built CLI, not src/
pnpm e2e                 # runs every test/*.test.mjs in this package
pnpm --filter @grounder/e2e e2e   # same, explicit
pnpm --filter @grounder/e2e exec vitest run test/ledger-migration.test.mjs   # run just one file
```

## Layout

```text
test/
  helpers.mjs                  # shared harness (CLI resolution, temp-dir cleanup) — not itself a test file
  ledger-migration.test.mjs    # v0.5.0 → current ledgerSchema upgrade, on a real migrate
  no-hooks.test.mjs            # session-hook fragment install / --no-hooks sticky opt-out
  legacy-retirement.test.mjs   # pre-skill command file tombstone retirement + --force
  drift-conflict.test.mjs      # hand-edited skill file conflict detection + --force
  copy-mode.test.mjs           # ~/.grounder/runtime copy mode (forced npx-cache-shaped source)
  link-and-note.test.mjs       # grounder link + note against a real project cwd (fixtures/minimal-git-repo)
  claude-agent.test.mjs        # --agent claude: settings.json SessionStart hook install/--no-hooks/merge
  multi-agent.test.mjs         # --agent cursor --agent claude together: shared runtime, ledger scoping, scoped migrate
  exit-codes.test.mjs          # real process exit codes for argv/state edge cases (help, unknown command, unlinked)
vitest.config.mjs              # this package's own config — separate from packages/grounder/vitest.config.ts
```

## Adding a new test

Drop a new `test/<name>.test.mjs` — vitest auto-discovers it via `vitest.config.mjs`'s `include` glob, no wiring needed elsewhere. Each test is self-contained: call `useE2eHarness(prefix)` from `helpers.mjs` for an isolated temp `GROUNDER_HOME`/vault, a `section()`/`log()` output buffer, and a `createCliRunner()`/`createRawCliRunner()` factory. Both return a `runCli(args, { cwd })`-shaped function — the plain one throws on a non-zero exit (a failed CLI call is a test failure) and returns stdout; the `Raw` one never throws and returns `{ stdout, stderr, status }`, for tests that assert on a call *expected* to fail. Pass `cwd` for commands like `link`/`note` that resolve from `process.cwd()` with no `--cwd` flag of their own — **and always pass it explicitly for those commands**, even when you want the "no linked project" case: leaving `cwd` unset means the child inherits this test runner's own cwd, which is inside this repo's own already-linked checkout, so an "unlinked" test needs `cwd` pinned somewhere with no ancestor `.git`/`.grounder.json` (e.g. `home`, since it's a fresh dir under `os.tmpdir()`). `helpers.mjs` also exports `stateJsonPath(home)`/`cursorHooksJsonPath(home)`/`claudeSettingsJsonPath(home)` for the on-disk paths most tests need to check — these are the e2e suite's own independently-hardcoded copies of the paths the real source computes (`connector/state.ts`, `agents/cursor.ts`, `agents/claude.ts`), not imports of those functions, since e2e never imports from `packages/grounder/src`. Assert with `expect.soft(...)` so one failed check doesn't hide the rest of the test. On a pass, nothing prints and the temp dirs are cleaned up; on a failure, the buffered `section()`/CLI output (real stdout+stderr) is flushed and the temp dirs are left on disk for inspection (path printed).
