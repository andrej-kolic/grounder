// E2E smoke test for the content-hash reconciler's conflict detection —
// replaced the old per-agent schema ints (2434df6). A skill file hand-edited
// since install must be left alone by a plain migrate and only overwritten
// with --force. Spawns the real built CLI against an isolated $HOME, so it
// also catches wiring bugs the in-process vitest suite can't.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { envWithHome, resolveCliPath, useE2eHarness } from "./helpers.mjs";

const cliPath = resolveCliPath();

test("migrate preserves a hand-edited skill file until --force", () => {
  const { home, vault, section, createCliRunner } = useE2eHarness("drift-smoke");
  const skillPath = path.join(home, ".cursor", "skills", "grounder-note", "SKILL.md");
  const runCli = createCliRunner(cliPath, envWithHome(home));

  section("1. Real setup (canonical skill file, hash recorded in the ledger)");
  runCli(["setup", vault, "--yes", "--agent", "cursor"]);
  const canonical = readFileSync(skillPath, "utf8");

  section("2. Hand-edit the skill file (simulates a user's local change)");
  const edited = `${canonical}\n<!-- local edit -->\n`;
  writeFileSync(skillPath, edited, "utf8");

  section("3. Plain migrate — must leave the conflict alone");
  runCli(["migrate"]);
  expect.soft(readFileSync(skillPath, "utf8"), "edit survives without --force").toBe(edited);

  section("4. migrate --force — overwrites back to canonical content");
  runCli(["migrate", "--force"]);
  expect
    .soft(readFileSync(skillPath, "utf8"), "file restored to canonical content")
    .toBe(canonical);
});
