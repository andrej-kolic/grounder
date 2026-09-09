// E2E smoke test for the reconciler's tombstone retirement — the real
// "skills instead of commands" migration a v0.5.0 user hits: pre-skill
// command files (e.g. .cursor/commands/grounder-note.md) that migrate
// deletes once they're a known, unedited leftover, and otherwise leaves
// alone until --force. Spawns the real built CLI against an isolated $HOME,
// so it also catches wiring bugs the in-process vitest suite can't.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { envWithHome, resolveCliPath, useE2eHarness } from "./helpers.mjs";

const cliPath = resolveCliPath();

function hashContent(content) {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

test("migrate auto-deletes only known, unedited legacy command files", () => {
  const { home, vault, section, createCliRunner } = useE2eHarness("retire-smoke");
  // The one pre-skill command path cursor.ts still tombstones.
  const legacyPath = path.join(home, ".cursor", "commands", "grounder-note.md");
  const statePath = path.join(home, ".grounder", "state.json");
  const runCli = createCliRunner(cliPath, envWithHome(home));

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

  section("1. Real setup (creates today's skill files)");
  runCli(["setup", vault, "--yes", "--agent", "cursor"]);

  section("2. Known, unedited legacy leftover — migrate should auto-delete it");
  const trackedContent = "old pre-skill note command\n";
  writeLegacyFile(trackedContent);
  recordLegacyHashInLedger(trackedContent);
  runCli(["migrate"]);
  expect.soft(existsSync(legacyPath), "legacy file deleted without --force").toBe(false);

  section("3. Untracked/hand-edited leftover — migrate must leave it alone");
  writeLegacyFile("hand-edited legacy command, never recorded in the ledger\n");
  runCli(["migrate"]);
  expect.soft(existsSync(legacyPath), "unrecorded legacy file left in place").toBe(true);

  section("4. migrate --force — now it may delete the left-alone file");
  runCli(["migrate", "--force"]);
  expect.soft(existsSync(legacyPath), "legacy file deleted with --force").toBe(false);
});
