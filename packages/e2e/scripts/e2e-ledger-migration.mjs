#!/usr/bin/env node
// Manual end-to-end smoke test for the ledgerSchema upgrade path (v0.5.0 → current).
// Unlike the vitest suite (which calls the internal functions directly), this spawns
// the real built CLI binary, so it also catches wiring bugs the in-process tests can't
// see (flag parsing, GROUNDER_HOME resolution, actual process exit codes).
//
// Usage: pnpm build && node packages/e2e/scripts/e2e-ledger-migration.mjs

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cliPath = path.join(repoRoot, "packages/grounder/dist/cli.js");

if (!existsSync(cliPath)) {
  console.error(`Not built: ${cliPath} is missing. Run "pnpm build" first.`);
  process.exit(1);
}

// Isolated $HOME for this run — never touches the real ~/.grounder.
const home = mkdtempSync(path.join(os.tmpdir(), "grounder-ledger-smoke-"));
const vault = mkdtempSync(path.join(os.tmpdir(), "grounder-ledger-smoke-vault-"));
const statePath = path.join(home, ".grounder", "state.json");
const env = { ...process.env, GROUNDER_HOME: home };

// stdio: "inherit" so the real CLI output (setup/migrate tables) prints live.
function runCli(args) {
  execFileSync("node", [cliPath, ...args], { env, stdio: "inherit" });
}

// Banner between steps so script output (checks, state dumps) is visually
// separate from the real CLI's own output (tables, prompts) inlined below it.
function section(title) {
  console.log(`\n=== ${title} ===`);
}

let failed = false;
function check(label, actual, expected) {
  const pass = actual === expected;
  if (!pass) failed = true;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label} (got: ${JSON.stringify(actual)})`);
}

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

try {
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
  check("ledgerSchema upgraded to 1", migrated.ledgerSchema, 1);
  check("commandsSchema dropped", migrated.agents.cursor.commandsSchema, undefined);
  check("hooksSchema dropped", migrated.agents.cursor.hooksSchema, undefined);
  check("hooksSchema:1 folded into hooksEnabled:true", migrated.agents.cursor.hooksEnabled, true);
  check("grounderVersion bumped off 0.5.0", migrated.grounderVersion !== "0.5.0", true);
} finally {
  section(failed ? "Result: FAIL" : "Result: PASS");
  if (failed) {
    console.log(`Left state for inspection:\n  home:  ${home}\n  vault: ${vault}`);
  } else {
    rmSync(home, { recursive: true, force: true });
    rmSync(vault, { recursive: true, force: true });
    console.log("Cleaned up temp home/vault.");
  }
}

process.exit(failed ? 1 : 0);
