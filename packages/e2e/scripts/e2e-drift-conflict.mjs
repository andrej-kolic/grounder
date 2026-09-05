#!/usr/bin/env node
// Manual end-to-end smoke test for the content-hash reconciler's conflict
// detection — replaced the old per-agent schema ints (2434df6). A skill file
// hand-edited since install must be left alone by a plain migrate and only
// overwritten with --force. Spawns the real built CLI against an isolated
// $HOME, so it also catches wiring bugs the in-process vitest suite can't.
//
// Usage: pnpm build && node packages/e2e/scripts/e2e-drift-conflict.mjs

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createChecker, createCliRunner, resolveCliPath, runE2eScript, section } from "./lib.mjs";

const cliPath = resolveCliPath(import.meta.url);

// Isolated $HOME for this run — never touches the real ~/.grounder or ~/.cursor.
const home = mkdtempSync(path.join(os.tmpdir(), "grounder-drift-smoke-"));
const vault = mkdtempSync(path.join(os.tmpdir(), "grounder-drift-smoke-vault-"));
const skillPath = path.join(home, ".cursor", "skills", "grounder-note", "SKILL.md");
const runCli = createCliRunner(cliPath, { ...process.env, GROUNDER_HOME: home });
const checker = createChecker();

await runE2eScript(
  async () => {
    section("1. Real setup (canonical skill file, hash recorded in the ledger)");
    runCli(["setup", vault, "--yes", "--agent", "cursor"]);
    const canonical = readFileSync(skillPath, "utf8");

    section("2. Hand-edit the skill file (simulates a user's local change)");
    const edited = `${canonical}\n<!-- local edit -->\n`;
    writeFileSync(skillPath, edited, "utf8");

    section("3. Plain migrate — must leave the conflict alone");
    runCli(["migrate"]);
    checker.check("edit survives without --force", readFileSync(skillPath, "utf8"), edited);

    section("4. migrate --force — overwrites back to canonical content");
    runCli(["migrate", "--force"]);
    checker.check("file restored to canonical content", readFileSync(skillPath, "utf8"), canonical);
  },
  { home, vault },
  checker,
);
