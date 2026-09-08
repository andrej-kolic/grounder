import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@vscode/test-cli";

const here = path.dirname(fileURLToPath(import.meta.url));

// Every temp dir this config creates, removed once the `vscode-test` CLI
// process (which stays alive for the whole run) exits — this file's own
// process, not the spawned Extension Development Host.
const tempDirs = [];
process.on("exit", () => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// VS Code's user-data-dir hosts a unix socket whose path must stay under the
// OS limit (~103 chars on macOS) — the repo's own path (especially inside a
// worktree) is too long for that, so route it through the OS temp dir instead.
// Each config below gets its own, so the two VS Code instances never collide.
function freshUserDataDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "grounder-vscode-test-userdata-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * A real linked project + vault, built once via the actual CLI (same
 * setup/link invocation as packages/grounder's own e2e suite) rather than
 * hand-writing .grounder.json/state.json — see AGENTS.md: never fabricate
 * Grounder's internal config/state files, always go through the CLI.
 */
function buildLinkedFixture() {
  const base = mkdtempSync(path.join(os.tmpdir(), "grounder-vscode-test-fixture-"));
  tempDirs.push(base);
  const homeDir = path.join(base, "home");
  const vaultDir = path.join(base, "vault");
  const repoDir = path.join(base, "repo");
  for (const dir of [homeDir, vaultDir, repoDir]) {
    mkdirSync(dir, { recursive: true });
  }

  const projectId = "grounder-vscode-test-fixture";
  writeFileSync(
    path.join(repoDir, "package.json"),
    `${JSON.stringify({ name: projectId }, null, 2)}\n`,
  );

  const cliPath = path.resolve(here, "../grounder/dist/cli.js");
  const env = { ...process.env, GROUNDER_HOME: homeDir, HOME: homeDir };
  const runCli = (args) =>
    execFileSync(process.execPath, [cliPath, ...args], { cwd: repoDir, env, stdio: "inherit" });

  runCli(["setup", vaultDir, "--agent", "claude", "--yes"]);
  runCli(["link", "--yes"]);

  const projectDir = path.join(vaultDir, "10-Projects", projectId);
  const notesDir = path.join(projectDir, "notes");
  const logsDir = path.join(projectDir, "logs");
  const plansDir = path.join(projectDir, "plans");

  const write = (filePath, content) => {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  };

  // Notes: one root-level doc, two nested subfolders — "Archive" (capitalized)
  // before "topics" (lowercase) proves case 2's case-insensitive folder sort.
  write(path.join(notesDir, "general-note.md"), "# General note\n");
  write(path.join(notesDir, "topics", "deep-dive.md"), "# Deep dive\n");
  write(path.join(notesDir, "Archive", "old-note.md"), "# Old note\n");

  // Handoffs: timestamp-prefixed, newest-basename-first (case 3).
  write(path.join(logsDir, "2026-01-01-1000-first-handoff.md"), "# First handoff\n");
  write(path.join(logsDir, "2026-01-02-1000-second-handoff.md"), "# Second handoff\n");

  // Plans: written in this order so beta-plan (newer mtime) sorts first (case 4).
  write(path.join(plansDir, "alpha-plan.md"), "# Alpha plan\n");
  write(path.join(plansDir, "beta-plan.md"), "# Beta plan\n");

  // An ad hoc extra vault folder, shown as its own "Discussions" category.
  write(path.join(projectDir, "discussions", "random-chat.md"), "# Random chat\n");

  // Loose root files (case 5) and dotfiles that must stay filtered out (case 6).
  write(path.join(projectDir, "root-doc-1.md"), "# Root doc 1\n");
  write(path.join(projectDir, "root-doc-2.md"), "# Root doc 2\n");
  write(path.join(projectDir, ".hidden-note.md"), "# Should be filtered out\n");
  write(path.join(projectDir, ".obsidian", "workspace.json"), "{}\n");

  return { homeDir, vaultDir, repoDir };
}

/**
 * A second project linked into the same vault/home as `buildLinkedFixture`'s
 * (no `setup` needed — the home config already points at the vault), for the
 * multi-root folder-grouping case.
 */
function buildSecondLinkedProject(homeDir, vaultDir) {
  const base = mkdtempSync(path.join(os.tmpdir(), "grounder-vscode-test-fixture2-"));
  tempDirs.push(base);
  const repoDir = path.join(base, "repo");
  mkdirSync(repoDir, { recursive: true });

  const projectId = "grounder-vscode-test-fixture-two";
  writeFileSync(
    path.join(repoDir, "package.json"),
    `${JSON.stringify({ name: projectId }, null, 2)}\n`,
  );

  const cliPath = path.resolve(here, "../grounder/dist/cli.js");
  const env = { ...process.env, GROUNDER_HOME: homeDir, HOME: homeDir };
  execFileSync(process.execPath, [cliPath, "link", "--yes"], {
    cwd: repoDir,
    env,
    stdio: "inherit",
  });

  const notesDir = path.join(vaultDir, "10-Projects", projectId, "notes");
  mkdirSync(notesDir, { recursive: true });
  writeFileSync(path.join(notesDir, "second-project-note.md"), "# Second project note\n");

  return { repoDir };
}

const linked = buildLinkedFixture();
const second = buildSecondLinkedProject(linked.homeDir, linked.vaultDir);

const multiRootWorkspaceFile = path.join(
  mkdtempSync(path.join(os.tmpdir(), "grounder-vscode-test-workspace-")),
  "multiroot.code-workspace",
);
tempDirs.push(path.dirname(multiRootWorkspaceFile));
writeFileSync(
  multiRootWorkspaceFile,
  JSON.stringify({ folders: [{ path: linked.repoDir }, { path: second.repoDir }] }, null, 2),
);

/**
 * On macOS, the downloaded test VS Code build can show a native "Keychain
 * Not Found" dialog on launch (Electron's `safeStorage` trying to create a
 * "Code Key" item) — a known `@vscode/test-electron` quirk, not something
 * this extension or its tests do. Confirmed non-blocking: every run here
 * completes and passes whether or not the dialog appears, dismissed or not.
 * If it appears, Cancel is always safe — never "Reset to Defaults" (wipes
 * the real login keychain for an unrelated disposable test profile). Neither
 * `--sync=off` nor `--password-store=basic` actually suppresses it (tried
 * both, and re-signing the downloaded app ad-hoc — the commonly cited fix —
 * is blocked by the OS on this codebase's `.vscode-test/` download); they're
 * kept anyway since they cheaply avoid unrelated auth/sync network noise.
 */
function commonLaunchArgs(userDataDir) {
  return [`--user-data-dir=${userDataDir}`, "--sync=off", "--password-store=basic"];
}

export default defineConfig({
  tests: [
    {
      label: "activation",
      files: "out/test-integration/extension.test.js",
      // Deliberately unlinked (no .grounder.json) — proves the harness boots
      // and the extension activates independent of any vault fixture.
      workspaceFolder: "test-integration/fixtures/empty-workspace",
      launchArgs: commonLaunchArgs(freshUserDataDir()),
      mocha: { timeout: 20_000 },
    },
    {
      label: "tree",
      files: "out/test-integration/tree.test.js",
      workspaceFolder: linked.repoDir,
      env: { GROUNDER_HOME: linked.homeDir, HOME: linked.homeDir },
      launchArgs: commonLaunchArgs(freshUserDataDir()),
      mocha: { timeout: 20_000 },
    },
    {
      label: "multiroot",
      files: "out/test-integration/multiroot.test.js",
      workspaceFolder: multiRootWorkspaceFile,
      env: { GROUNDER_HOME: linked.homeDir, HOME: linked.homeDir },
      launchArgs: commonLaunchArgs(freshUserDataDir()),
      mocha: { timeout: 20_000 },
    },
  ],
});
