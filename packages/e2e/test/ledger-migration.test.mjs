// E2E smoke test for the ledgerSchema upgrade path (v0.5.0 → current).
// Unlike packages/grounder/test/ (vitest calling the internal functions
// directly), this spawns the real built CLI binary, so it also catches
// wiring bugs the in-process suite can't see (flag parsing, GROUNDER_HOME
// resolution, actual process exit codes).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  cursorHooksJsonPath,
  envWithHome,
  resolveCliPath,
  stateJsonPath,
  useE2eHarness,
} from "./helpers.mjs";

const cliPath = resolveCliPath();

// Pretty-print, with each agent's file-hash map collapsed to a count — the
// per-file hashes are real but too long (full tmp paths + sha256s) to read
// at a glance, and they're not what this test is checking.
function printState(label, state, log) {
  const compact = structuredClone(state);
  for (const agent of Object.values(compact.agents ?? {})) {
    if (agent.files) {
      agent.files = `<${Object.keys(agent.files).length} files>`;
    }
  }
  log(`${label}:\n${JSON.stringify(compact, null, 2)}`);
}

test("migrate upgrades a v0.5.0 ledger to the current schema", () => {
  const { home, vault, log, section, createCliRunner } = useE2eHarness("ledger-smoke");
  const statePath = stateJsonPath(home);
  const runCli = createCliRunner(cliPath, envWithHome(home));

  section("1. Real setup (fresh, current-schema state.json)");
  runCli(["setup", vault, "--yes", "--agent", "cursor"]);
  const fresh = JSON.parse(readFileSync(statePath, "utf8"));

  section(
    "2. Overwrite state.json with a pre-ledgerSchema-1 (v0.5.0) shape, so migrate has something to upgrade",
  );
  // commandsSchema/hooksSchema, no ledgerSchema field — same file hashes as
  // the fresh install above, so the only pending change migrate should make
  // is to the ledger's own format, not a file reconcile.
  const legacy = {
    grounderVersion: "0.5.0",
    agents: {
      cursor: { commandsSchema: 4, hooksSchema: 1, files: fresh.agents.cursor.files },
    },
  };
  writeFileSync(statePath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
  printState("Before migrate", legacy, log);

  section("3. Run migrate — should upgrade the ledger and persist it");
  runCli(["migrate"]);
  const migrated = JSON.parse(readFileSync(statePath, "utf8"));
  printState("After migrate", migrated, log);

  section("4. Checks");
  expect.soft(migrated.ledgerSchema, "ledgerSchema upgraded to 1").toBe(1);
  expect.soft(migrated.agents.cursor.commandsSchema, "commandsSchema dropped").toBeUndefined();
  expect.soft(migrated.agents.cursor.hooksSchema, "hooksSchema dropped").toBeUndefined();
  expect
    .soft(migrated.agents.cursor.hooksEnabled, "hooksSchema:1 folded into hooksEnabled:true")
    .toBe(true);
  expect.soft(migrated.grounderVersion, "grounderVersion bumped off 0.5.0").not.toBe("0.5.0");

  // `hooksEnabled:true` (just asserted above) makes this plain `migrate` a
  // real side effect, not a no-op: step 1's setup never passed `--hooks`, so
  // this is the migrate run that actually installs the session hook.
  const hooksJsonPath = cursorHooksJsonPath(home);
  const hooksInstalled =
    existsSync(hooksJsonPath) &&
    JSON.stringify(JSON.parse(readFileSync(hooksJsonPath, "utf8"))).includes("handoff peek");
  expect
    .soft(hooksInstalled, "hooksEnabled:true side effect: hooks.json now has a Grounder entry")
    .toBe(true);
});
