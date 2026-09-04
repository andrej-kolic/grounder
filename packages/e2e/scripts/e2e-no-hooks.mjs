#!/usr/bin/env node
// Manual end-to-end smoke test for the session-hook fragment reconciler and
// `--no-hooks`'s sticky opt-out. Spawns the real built CLI against an
// isolated $HOME, so it also catches wiring bugs the in-process vitest
// suite can't see (flag parsing, GROUNDER_HOME resolution, real file I/O).
//
// Usage: pnpm build && node packages/e2e/scripts/e2e-no-hooks.mjs

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cliPath = path.join(repoRoot, "packages/grounder/dist/cli.js");

if (!existsSync(cliPath)) {
  console.error(`Not built: ${cliPath} is missing. Run "pnpm build" first.`);
  process.exit(1);
}

// Isolated $HOME for this run — never touches the real ~/.grounder or ~/.cursor.
const home = mkdtempSync(path.join(os.tmpdir(), "grounder-nohooks-smoke-"));
const vault = mkdtempSync(path.join(os.tmpdir(), "grounder-nohooks-smoke-vault-"));
const statePath = path.join(home, ".grounder", "state.json");
const hooksJsonPath = path.join(home, ".cursor", "hooks.json");
const env = { ...process.env, GROUNDER_HOME: home };

// stdio: "inherit" so the real CLI output (setup/migrate tables) prints live.
function runCli(args) {
  execFileSync("node", [cliPath, ...args], { env, stdio: "inherit" });
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

let failed = false;
function check(label, actual, expected) {
  const pass = actual === expected;
  if (!pass) failed = true;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label} (got: ${JSON.stringify(actual)})`);
}

function readHooksEnabled() {
  return JSON.parse(readFileSync(statePath, "utf8")).agents.cursor?.hooksEnabled;
}

// True when hooks.json's sessionStart array has Grounder's one canonical
// entry — good enough for this script; matches on the "handoff peek"
// substring every real Grounder entry's command contains.
function hooksJsonHasGrounderEntry() {
  if (!existsSync(hooksJsonPath)) {
    return false;
  }
  const parsed = JSON.parse(readFileSync(hooksJsonPath, "utf8"));
  const sessionStart = parsed.hooks?.sessionStart ?? [];
  return sessionStart.some((entry) => String(entry.command ?? "").includes("handoff peek"));
}

try {
  section("1. Real setup --hooks (installs the sessionStart fragment)");
  runCli(["setup", vault, "--yes", "--agent", "cursor", "--hooks"]);
  check("hooks.json has the grounder entry", hooksJsonHasGrounderEntry(), true);
  check("state.json hooksEnabled: true", readHooksEnabled(), true);

  section("2. migrate --no-hooks (removes the fragment, sticky opt-out)");
  runCli(["migrate", "--no-hooks"]);
  check("hooks.json entry removed", hooksJsonHasGrounderEntry(), false);
  check("state.json hooksEnabled: false", readHooksEnabled(), false);

  section("3. plain migrate (must NOT re-hydrate hooks — opt-out is sticky)");
  runCli(["migrate"]);
  check("hooks.json entry still absent", hooksJsonHasGrounderEntry(), false);
  check("state.json hooksEnabled still false", readHooksEnabled(), false);

  section("4. migrate --hooks (explicit re-enable)");
  runCli(["migrate", "--hooks"]);
  check("hooks.json entry reinstalled", hooksJsonHasGrounderEntry(), true);
  check("state.json hooksEnabled: true again", readHooksEnabled(), true);
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
