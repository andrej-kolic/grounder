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
vitest.config.mjs              # this package's own config — separate from packages/grounder/vitest.config.ts
```

## Adding a new test

Drop a new `test/<name>.test.mjs` — vitest auto-discovers it via `vitest.config.mjs`'s `include` glob, no wiring needed elsewhere. Each test is self-contained: call `useE2eHarness(prefix)` from `helpers.mjs` for an isolated temp `GROUNDER_HOME`/vault, a `section()`/`log()` output buffer, and a `createCliRunner()` factory. Assert with `expect.soft(...)` so one failed check doesn't hide the rest of the test. On a pass, nothing prints and the temp dirs are cleaned up; on a failure, the buffered `section()`/CLI output (real stdout+stderr) is flushed and the temp dirs are left on disk for inspection (path printed).
