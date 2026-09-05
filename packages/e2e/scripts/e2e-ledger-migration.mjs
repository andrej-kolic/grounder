#!/usr/bin/env node
// Manual end-to-end smoke test for the ledgerSchema upgrade path (v0.5.0 → current).
// Unlike the vitest suite (which calls the internal functions directly), this spawns
// the real built CLI binary, so it also catches wiring bugs the in-process tests can't
// see (flag parsing, GROUNDER_HOME resolution, actual process exit codes).
//
// Usage: pnpm build && node packages/e2e/scripts/e2e-ledger-migration.mjs

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createChecker, createCliRunner, resolveCliPath, runE2eScript, section } from "./lib.mjs";

const cliPath = resolveCliPath(import.meta.url);

// Isolated $HOME for this run — never touches the real ~/.grounder.
const home = mkdtempSync(path.join(os.tmpdir(), "grounder-ledger-smoke-"));
const vault = mkdtempSync(path.join(os.tmpdir(), "grounder-ledger-smoke-vault-"));
const statePath = path.join(home, ".grounder", "state.json");
const runCli = createCliRunner(cliPath, { ...process.env, GROUNDER_HOME: home });
const checker = createChecker();

// Pretty-print, with each agent's file-hash map collapsed to a count — the
// per-file hashes are real but too long (full tmp paths + sha256s) to read
// at a glance, and they're not what this script is checking.
function printState(label, state) {
  const compact = structuredClone(state);
  for (const agent of Object.values(compact.agents ?? {})) {
    if (agent.files) {
      agent.files = `<${Object.keys(agent.files).length} files>`;
    }
  }
  console.log(`${label}:\n${JSON.stringify(compact, null, 2)}`);
}

await runE2eScript(
  async () => {
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
    printState("Before migrate", legacy);

    section("3. Run migrate — should upgrade the ledger and persist it");
    runCli(["migrate"]);
    const migrated = JSON.parse(readFileSync(statePath, "utf8"));
    printState("After migrate", migrated);

    section("4. Checks");
    checker.check("ledgerSchema upgraded to 1", migrated.ledgerSchema, 1);
    checker.check("commandsSchema dropped", migrated.agents.cursor.commandsSchema, undefined);
    checker.check("hooksSchema dropped", migrated.agents.cursor.hooksSchema, undefined);
    checker.check(
      "hooksSchema:1 folded into hooksEnabled:true",
      migrated.agents.cursor.hooksEnabled,
      true,
    );
    checker.check("grounderVersion bumped off 0.5.0", migrated.grounderVersion !== "0.5.0", true);

    // `hooksEnabled:true` (just asserted above) makes this plain `migrate` a
    // real side effect, not a no-op: step 1's setup never passed `--hooks`, so
    // this is the migrate run that actually installs the session hook.
    const hooksJsonPath = path.join(home, ".cursor", "hooks.json");
    const hooksInstalled =
      existsSync(hooksJsonPath) &&
      JSON.stringify(JSON.parse(readFileSync(hooksJsonPath, "utf8"))).includes("handoff peek");
    checker.check(
      "hooksEnabled:true side effect: hooks.json now has a Grounder entry",
      hooksInstalled,
      true,
    );
  },
  { home, vault },
  checker,
);
