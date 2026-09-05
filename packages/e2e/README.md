# `@grounder/e2e`

Private workspace package of manual end-to-end smoke scripts for the `grounder` CLI. Unlike `packages/grounder/test/` (vitest, calls the internal functions in-process), each `scripts/e2e-*.mjs` spawns the real built `dist/cli.js` against an isolated `GROUNDER_HOME`/vault temp dir — so it also catches wiring bugs the in-process suite can't (flag parsing, env resolution, real file I/O, actual exit codes).

**Not published to npm.**

## Usage

```bash
pnpm build               # from repo root — these scripts run the built CLI, not src/
pnpm e2e                 # runs every scripts/e2e-*.mjs in this package
pnpm --filter @grounder/e2e e2e   # same, explicit
node packages/e2e/scripts/e2e-ledger-migration.mjs   # run just one
```

## Layout

```text
scripts/
  run-e2e.mjs                  # discovers and runs every e2e-*.mjs in this dir
  lib.mjs                      # shared harness (CLI resolution, checks, PASS/FAIL/cleanup) — not a script itself
  e2e-ledger-migration.mjs     # v0.5.0 → current ledgerSchema upgrade, on a real migrate
  e2e-no-hooks.mjs             # session-hook fragment install / --no-hooks sticky opt-out
  e2e-legacy-retirement.mjs    # pre-skill command file tombstone retirement + --force
  e2e-drift-conflict.mjs       # hand-edited skill file conflict detection + --force
  e2e-copy-mode.mjs            # ~/.grounder/runtime copy mode (forced npx-cache-shaped source)
```

## Adding a new script

Drop a new `scripts/e2e-<name>.mjs` — `run-e2e.mjs` auto-discovers it (glob on the `e2e-*.mjs` filename), no wiring needed elsewhere (`lib.mjs` is exempt from the glob, so shared helpers can live there without being run as a script). Each script is self-contained: build its own isolated temp `GROUNDER_HOME`/vault, spawn the CLI via `execFileSync`, print `PASS`/`FAIL` per check, clean up on success (leaves the temp dirs for inspection on failure), and exit non-zero on any failed check.
