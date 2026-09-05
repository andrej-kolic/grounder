#!/usr/bin/env node
// Manual end-to-end smoke test for the session-hook fragment reconciler and
// `--no-hooks`'s sticky opt-out. Spawns the real built CLI against an
// isolated $HOME, so it also catches wiring bugs the in-process vitest
// suite can't see (flag parsing, GROUNDER_HOME resolution, real file I/O).
//
// Usage: pnpm build && node packages/e2e/scripts/e2e-no-hooks.mjs

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createChecker, createCliRunner, resolveCliPath, runE2eScript, section } from "./lib.mjs";

const cliPath = resolveCliPath(import.meta.url);

// Isolated $HOME for this run — never touches the real ~/.grounder or ~/.cursor.
const home = mkdtempSync(path.join(os.tmpdir(), "grounder-nohooks-smoke-"));
const vault = mkdtempSync(path.join(os.tmpdir(), "grounder-nohooks-smoke-vault-"));
const statePath = path.join(home, ".grounder", "state.json");
const hooksJsonPath = path.join(home, ".cursor", "hooks.json");
const runCli = createCliRunner(cliPath, { ...process.env, GROUNDER_HOME: home });
const checker = createChecker();

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

await runE2eScript(
  async () => {
    section("1. Real setup --hooks (installs the sessionStart fragment)");
    runCli(["setup", vault, "--yes", "--agent", "cursor", "--hooks"]);
    checker.check("hooks.json has the grounder entry", hooksJsonHasGrounderEntry(), true);
    checker.check("state.json hooksEnabled: true", readHooksEnabled(), true);

    section("2. migrate --no-hooks (removes the fragment, sticky opt-out)");
    runCli(["migrate", "--no-hooks"]);
    checker.check("hooks.json entry removed", hooksJsonHasGrounderEntry(), false);
    checker.check("state.json hooksEnabled: false", readHooksEnabled(), false);

    section("3. plain migrate (must NOT re-hydrate hooks — opt-out is sticky)");
    runCli(["migrate"]);
    checker.check("hooks.json entry still absent", hooksJsonHasGrounderEntry(), false);
    checker.check("state.json hooksEnabled still false", readHooksEnabled(), false);

    section("4. migrate --hooks (explicit re-enable)");
    runCli(["migrate", "--hooks"]);
    checker.check("hooks.json entry reinstalled", hooksJsonHasGrounderEntry(), true);
    checker.check("state.json hooksEnabled: true again", readHooksEnabled(), true);
  },
  { home, vault },
  checker,
);
