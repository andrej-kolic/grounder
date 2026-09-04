#!/usr/bin/env node
// Manual end-to-end smoke test for the content-hash reconciler's conflict
// detection — replaced the old per-agent schema ints (2434df6). A skill file
// hand-edited since install must be left alone by a plain migrate and only
// overwritten with --force. Spawns the real built CLI against an isolated
// $HOME, so it also catches wiring bugs the in-process vitest suite can't.
//
// Usage: pnpm build && node packages/e2e/scripts/e2e-drift-conflict.mjs

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

// Isolated $HOME for this run — never touches the real ~/.grounder or ~/.cursor.
const home = mkdtempSync(path.join(os.tmpdir(), "grounder-drift-smoke-"));
const vault = mkdtempSync(path.join(os.tmpdir(), "grounder-drift-smoke-vault-"));
const skillPath = path.join(home, ".cursor", "skills", "grounder-note", "SKILL.md");
const env = { ...process.env, GROUNDER_HOME: home };

function runCli(args) {
  execFileSync("node", [cliPath, ...args], { env, stdio: "inherit" });
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

// Full file content is too long to dump on every PASS — just say how long it
// is; a FAIL still needs the real value, so print that one in full.
function summarize(value) {
  if (typeof value === "string" && value.length > 80) {
    return `<string, ${value.length} chars>`;
  }
  return JSON.stringify(value);
}

let failed = false;
function check(label, actual, expected) {
  const pass = actual === expected;
  if (!pass) failed = true;
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${label} (got: ${pass ? summarize(actual) : JSON.stringify(actual)})`,
  );
}

try {
  section("1. Real setup (canonical skill file, hash recorded in the ledger)");
  runCli(["setup", vault, "--yes", "--agent", "cursor"]);
  const canonical = readFileSync(skillPath, "utf8");

  section("2. Hand-edit the skill file (simulates a user's local change)");
  const edited = `${canonical}\n<!-- local edit -->\n`;
  writeFileSync(skillPath, edited, "utf8");

  section("3. Plain migrate — must leave the conflict alone");
  runCli(["migrate"]);
  check("edit survives without --force", readFileSync(skillPath, "utf8"), edited);

  section("4. migrate --force — overwrites back to canonical content");
  runCli(["migrate", "--force"]);
  check("file restored to canonical content", readFileSync(skillPath, "utf8"), canonical);
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
