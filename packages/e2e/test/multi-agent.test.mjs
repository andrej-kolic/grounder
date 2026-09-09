// E2E smoke test for installing two agents in one run (--agent cursor
// --agent claude). Every other e2e test installs exactly one agent, so none
// of them exercise the cross-agent wiring apply.ts documents as real risk:
//   - one shared runtime materialization (installHookRuntime called once,
//     both agents' hook commands must point at the same runtime cli path)
//   - one state.json ledger with an independent agents.cursor / agents.claude
//     entry each — ownedLedgerFiles()/ownedPrefixes() must keep each agent's
//     `files` map scoped to its own paths, never the other's
//   - per-agent isolation: apply.ts wraps each agent's hook step in its own
//     try/catch specifically so one agent's install/removal can't affect the
//     other in the same run — a scoped `migrate --agent cursor` must leave
//     claude's hook and ledger entry completely untouched, and vice versa

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import {
  claudeSettingsJsonPath,
  cursorHooksJsonPath,
  envWithHome,
  resolveCliPath,
  stateJsonPath,
  useE2eHarness,
} from "./helpers.mjs";

const cliPath = resolveCliPath();

test("setup installs two agents together, and a scoped migrate only touches one", () => {
  const { home, vault, section, createCliRunner } = useE2eHarness("multi-agent");
  const statePath = stateJsonPath(home);
  const cursorHooksPath = cursorHooksJsonPath(home);
  const claudeSettingsPath = claudeSettingsJsonPath(home);
  const runCli = createCliRunner(cliPath, envWithHome(home));

  function readState() {
    return JSON.parse(readFileSync(statePath, "utf8"));
  }

  function cursorSessionStartHasGrounderEntry() {
    if (!existsSync(cursorHooksPath)) return false;
    const sessionStart =
      JSON.parse(readFileSync(cursorHooksPath, "utf8")).hooks?.sessionStart ?? [];
    return sessionStart.some((entry) => String(entry.command ?? "").includes("handoff peek"));
  }

  function claudeSessionStartHasGrounderEntry() {
    if (!existsSync(claudeSettingsPath)) return false;
    const sessionStart =
      JSON.parse(readFileSync(claudeSettingsPath, "utf8")).hooks?.SessionStart ?? [];
    return sessionStart.some((group) =>
      (group.hooks ?? []).some((hook) => String(hook.command ?? "").includes("handoff peek")),
    );
  }

  section("1. Real setup --agent cursor --agent claude --hooks (both in one run)");
  runCli(["setup", vault, "--yes", "--agent", "cursor", "--agent", "claude", "--hooks"]);

  const afterSetup = readState();
  const cursorFiles = afterSetup.agents.cursor?.files ?? {};
  const claudeFiles = afterSetup.agents.claude?.files ?? {};
  expect.soft(Object.keys(cursorFiles).length > 0, "cursor's ledger has file entries").toBe(true);
  expect.soft(Object.keys(claudeFiles).length > 0, "claude's ledger has file entries").toBe(true);
  expect
    .soft(
      Object.keys(cursorFiles).every((p) => p.includes(`${path.sep}.cursor${path.sep}`)),
      "cursor's ledger entries are scoped to .cursor/ paths only",
    )
    .toBe(true);
  expect
    .soft(
      Object.keys(claudeFiles).every((p) => p.includes(`${path.sep}.claude${path.sep}`)),
      "claude's ledger entries are scoped to .claude/ paths only",
    )
    .toBe(true);

  expect.soft(cursorSessionStartHasGrounderEntry(), "cursor's hooks.json has the entry").toBe(true);
  expect
    .soft(claudeSessionStartHasGrounderEntry(), "claude's settings.json has the entry")
    .toBe(true);

  const runtimeCliPath = path.join(home, ".grounder", "runtime", "dist", "cli.js");
  expect.soft(existsSync(runtimeCliPath), "one shared runtime was materialized").toBe(true);
  const cursorHookCommand = JSON.parse(
    readFileSync(cursorHooksPath, "utf8"),
  ).hooks.sessionStart.find((e) => String(e.command ?? "").includes("handoff peek"))?.command;
  const claudeHookCommand = JSON.parse(readFileSync(claudeSettingsPath, "utf8"))
    .hooks.SessionStart.flatMap((g) => g.hooks ?? [])
    .find((h) => String(h.command ?? "").includes("handoff peek"))?.command;
  expect
    .soft(cursorHookCommand, "cursor's hook command references the shared runtime")
    .toContain(runtimeCliPath);
  expect
    .soft(claudeHookCommand, "claude's hook command references the same shared runtime")
    .toContain(runtimeCliPath);

  // Each scoped-removal direction below is checked while the *other* agent's
  // hook is still live (not already off from a prior step) — the only way
  // to actually prove a scoped migrate can't strip a live hook it doesn't
  // own, as opposed to merely not resurrecting one that's already off. So
  // this direction runs first (both still live from setup above), and
  // migrate --agent cursor's turn (below) gets a fresh re-enable of claude
  // first, for the same reason.
  section(
    "2. migrate --agent claude --no-hooks (scoped — must not touch cursor's still-live hook)",
  );
  runCli(["migrate", "--agent", "claude", "--no-hooks"]);
  expect.soft(claudeSessionStartHasGrounderEntry(), "claude's hook removed").toBe(false);
  expect.soft(readState().agents.claude?.hooksEnabled, "claude's hooksEnabled: false").toBe(false);
  expect
    .soft(
      cursorSessionStartHasGrounderEntry(),
      "cursor's still-live hook untouched by a claude-scoped migrate",
    )
    .toBe(true);
  expect
    .soft(readState().agents.cursor?.hooksEnabled, "cursor's hooksEnabled untouched (still true)")
    .toBe(true);

  section("3. migrate --agent claude --hooks (re-enable claude, restore the both-live baseline)");
  runCli(["migrate", "--agent", "claude", "--hooks"]);
  expect.soft(claudeSessionStartHasGrounderEntry(), "claude's hook reinstalled").toBe(true);

  section(
    "4. migrate --agent cursor --no-hooks (scoped — must not touch claude's still-live hook)",
  );
  runCli(["migrate", "--agent", "cursor", "--no-hooks"]);
  expect.soft(cursorSessionStartHasGrounderEntry(), "cursor's hook removed").toBe(false);
  expect.soft(readState().agents.cursor?.hooksEnabled, "cursor's hooksEnabled: false").toBe(false);
  expect
    .soft(
      claudeSessionStartHasGrounderEntry(),
      "claude's still-live hook untouched by a cursor-scoped migrate",
    )
    .toBe(true);
  expect
    .soft(readState().agents.claude?.hooksEnabled, "claude's hooksEnabled untouched (still true)")
    .toBe(true);

  section("5. plain migrate (auto-detects both from the ledger) — cursor stays opted out");
  runCli(["migrate"]);
  expect
    .soft(
      cursorSessionStartHasGrounderEntry(),
      "cursor's opt-out is sticky across an unscoped migrate",
    )
    .toBe(false);
  expect
    .soft(
      claudeSessionStartHasGrounderEntry(),
      "claude's hook still present after the same migrate",
    )
    .toBe(true);
});
