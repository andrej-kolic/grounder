// E2E smoke test for the session-hook fragment reconciler and --no-hooks's
// sticky opt-out. Spawns the real built CLI against an isolated $HOME, so it
// also catches wiring bugs the in-process vitest suite can't see (flag
// parsing, GROUNDER_HOME resolution, real file I/O).

import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  cursorHooksJsonPath,
  envWithHome,
  resolveCliPath,
  stateJsonPath,
  useE2eHarness,
} from "./helpers.mjs";

const cliPath = resolveCliPath();

test("--no-hooks sticky opt-out survives a plain migrate", () => {
  const { home, vault, section, createCliRunner } = useE2eHarness("nohooks-smoke");
  const statePath = stateJsonPath(home);
  const hooksJsonPath = cursorHooksJsonPath(home);
  const runCli = createCliRunner(cliPath, envWithHome(home));

  function readHooksEnabled() {
    return JSON.parse(readFileSync(statePath, "utf8")).agents.cursor?.hooksEnabled;
  }

  // True when hooks.json's sessionStart array has Grounder's one canonical
  // entry — good enough for this test; matches on the "handoff peek"
  // substring every real Grounder entry's command contains.
  function hooksJsonHasGrounderEntry() {
    if (!existsSync(hooksJsonPath)) {
      return false;
    }
    const parsed = JSON.parse(readFileSync(hooksJsonPath, "utf8"));
    const sessionStart = parsed.hooks?.sessionStart ?? [];
    return sessionStart.some((entry) => String(entry.command ?? "").includes("handoff peek"));
  }

  section("1. Real setup --hooks (installs the sessionStart fragment)");
  runCli(["setup", vault, "--yes", "--agent", "cursor", "--hooks"]);
  expect.soft(hooksJsonHasGrounderEntry(), "hooks.json has the grounder entry").toBe(true);
  expect.soft(readHooksEnabled(), "state.json hooksEnabled: true").toBe(true);

  section("2. migrate --no-hooks (removes the fragment, sticky opt-out)");
  runCli(["migrate", "--no-hooks"]);
  expect.soft(hooksJsonHasGrounderEntry(), "hooks.json entry removed").toBe(false);
  expect.soft(readHooksEnabled(), "state.json hooksEnabled: false").toBe(false);

  section("3. plain migrate (must NOT re-hydrate hooks — opt-out is sticky)");
  runCli(["migrate"]);
  expect.soft(hooksJsonHasGrounderEntry(), "hooks.json entry still absent").toBe(false);
  expect.soft(readHooksEnabled(), "state.json hooksEnabled still false").toBe(false);

  section("4. migrate --hooks (explicit re-enable)");
  runCli(["migrate", "--hooks"]);
  expect.soft(hooksJsonHasGrounderEntry(), "hooks.json entry reinstalled").toBe(true);
  expect.soft(readHooksEnabled(), "state.json hooksEnabled: true again").toBe(true);
});
