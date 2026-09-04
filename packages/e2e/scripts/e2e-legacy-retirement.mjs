#!/usr/bin/env node
// Manual end-to-end smoke test for the reconciler's tombstone retirement —
// the real "skills instead of commands" migration a v0.5.0 user hits:
// pre-skill command files (e.g. .cursor/commands/grounder-note.md) that
// migrate deletes once they're a known, unedited leftover, and otherwise
// leaves alone until --force. Spawns the real built CLI against an isolated
// $HOME, so it also catches wiring bugs the in-process vitest suite can't.
//
// Usage: pnpm build && node packages/e2e/scripts/e2e-legacy-retirement.mjs

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const home = mkdtempSync(path.join(os.tmpdir(), "grounder-retire-smoke-"));
const vault = mkdtempSync(path.join(os.tmpdir(), "grounder-retire-smoke-vault-"));
const statePath = path.join(home, ".grounder", "state.json");
// The one pre-skill command path cursor.ts still tombstones.
const legacyPath = path.join(home, ".cursor", "commands", "grounder-note.md");
const env = { ...process.env, GROUNDER_HOME: home };

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

function hashContent(content) {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function writeLegacyFile(content) {
  mkdirSync(path.dirname(legacyPath), { recursive: true });
  writeFileSync(legacyPath, content, "utf8");
}

// Record the legacy file's hash in the ledger, as if a real v0.5.0 install
// had tracked it — merged into cursor's existing files map, not replacing it.
function recordLegacyHashInLedger(content) {
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.agents.cursor.files[legacyPath] = { hash: hashContent(content) };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

try {
  section("1. Real setup (creates today's skill files)");
  runCli(["setup", vault, "--yes", "--agent", "cursor"]);

  section("2. Known, unedited legacy leftover — migrate should auto-delete it");
  const trackedContent = "old pre-skill note command\n";
  writeLegacyFile(trackedContent);
  recordLegacyHashInLedger(trackedContent);
  runCli(["migrate"]);
  check("legacy file deleted without --force", existsSync(legacyPath), false);

  section("3. Untracked/hand-edited leftover — migrate must leave it alone");
  writeLegacyFile("hand-edited legacy command, never recorded in the ledger\n");
  runCli(["migrate"]);
  check("unrecorded legacy file left in place", existsSync(legacyPath), true);

  section("4. migrate --force — now it may delete the left-alone file");
  runCli(["migrate", "--force"]);
  check("legacy file deleted with --force", existsSync(legacyPath), false);
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
