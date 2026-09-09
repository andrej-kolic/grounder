// E2E smoke test for the Claude Code adapter (--agent claude) in isolation.
// (multi-agent.test.mjs also installs Claude, but alongside Cursor in one
// run — this file is the one that exercises Claude's install/removal
// lifecycle end to end on its own.) Claude's install path is genuinely
// different wiring from Cursor's, not just a same-shape variant:
//   - hook file: ~/.claude/settings.json, not ~/.cursor/hooks.json
//   - shape: hooks.SessionStart is an array of matcher groups
//     ({ matcher, hooks: [{ type: "command", command }] }), not Cursor's
//     flat hooks.sessionStart array of { command } entries (see
//     agents/claude.ts's top-of-file doc comment for the full shape)
//   - command: no trailing `--json` (Cursor's default; Claude's
//     peekHookCommand call passes no extraArgs — see cursorPeekHookCommand
//     vs claudePeekHookCommand in agents/cursor.ts / agents/claude.ts)
//   - settings.json is a general-purpose shared file (permissions, other
//     hook events, ...) that mergeClaudeHooks must preserve untouched
//     outside the one SessionStart entry it owns

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import {
  claudeSettingsJsonPath,
  envWithHome,
  resolveCliPath,
  stateJsonPath,
  useE2eHarness,
} from "./helpers.mjs";

const cliPath = resolveCliPath();

test("--agent claude installs and removes its SessionStart hook without disturbing unrelated settings", () => {
  const { home, vault, section, createCliRunner } = useE2eHarness("claude-agent");
  const statePath = stateJsonPath(home);
  const settingsPath = claudeSettingsJsonPath(home);
  const runCli = createCliRunner(cliPath, envWithHome(home));

  function readHooksEnabled() {
    return JSON.parse(readFileSync(statePath, "utf8")).agents.claude?.hooksEnabled;
  }

  function readSettings() {
    return existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : null;
  }

  // Matches Claude's real shape: hooks.SessionStart[].hooks[].command, not
  // Cursor's flat hooks.sessionStart[].command.
  function grounderSessionStartEntries() {
    const sessionStart = readSettings()?.hooks?.SessionStart ?? [];
    return sessionStart.flatMap((group) =>
      (group.hooks ?? []).filter((hook) => String(hook.command ?? "").includes("handoff peek")),
    );
  }

  // Re-run after every step, not just after install — a `removeClaudeHooks`
  // or re-install that rebuilds `hooks` from scratch instead of spreading
  // the existing object would keep top-level `permissions` (a sibling key)
  // but silently drop `PreToolUse` (a sibling *inside* `hooks`), so both
  // need checking at each step, not just one.
  function expectUnrelatedSettingsSurvive(afterLabel) {
    const settings = readSettings();
    expect
      .soft(settings.permissions, `pre-existing permissions key survives ${afterLabel}`)
      .toEqual({ allow: ["Bash(ls:*)"] });
    expect
      .soft(settings.hooks.PreToolUse, `unrelated PreToolUse hook event survives ${afterLabel}`)
      .toEqual([{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }]);
  }

  section("0. Pre-seed settings.json with unrelated keys a real user would already have");
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(
    settingsPath,
    `${JSON.stringify(
      {
        permissions: { allow: ["Bash(ls:*)"] },
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  section("1. Real setup --agent claude --hooks (installs the SessionStart fragment)");
  runCli(["setup", vault, "--yes", "--agent", "claude", "--hooks"]);
  const entries = grounderSessionStartEntries();
  expect.soft(entries.length, "exactly one Grounder SessionStart entry installed").toBe(1);
  expect
    .soft(
      entries[0]?.command,
      "Claude's hook command has no trailing --json (that's Cursor's default)",
    )
    .not.toContain("--json");
  expect.soft(readHooksEnabled(), "state.json hooksEnabled: true").toBe(true);
  expectUnrelatedSettingsSurvive("install");

  section("2. migrate --no-hooks (removes the fragment, sticky opt-out)");
  runCli(["migrate", "--no-hooks"]);
  expect.soft(grounderSessionStartEntries().length, "SessionStart entry removed").toBe(0);
  expect.soft(readHooksEnabled(), "state.json hooksEnabled: false").toBe(false);
  expectUnrelatedSettingsSurvive("removal");

  section("3. plain migrate (must NOT re-hydrate hooks — opt-out is sticky)");
  runCli(["migrate"]);
  expect.soft(grounderSessionStartEntries().length, "SessionStart entry still absent").toBe(0);
  expect.soft(readHooksEnabled(), "state.json hooksEnabled still false").toBe(false);

  section("4. migrate --hooks (explicit re-enable)");
  runCli(["migrate", "--hooks"]);
  expect.soft(grounderSessionStartEntries().length, "SessionStart entry reinstalled").toBe(1);
  expect.soft(readHooksEnabled(), "state.json hooksEnabled: true again").toBe(true);
  expectUnrelatedSettingsSurvive("re-enable");
});
