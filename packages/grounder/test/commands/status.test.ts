import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLinkWithOptions } from "../../src/commands/link.js";
import { runSetupWithOptions } from "../../src/commands/setup.js";
import { runStatusWithOptions } from "../../src/commands/status.js";
import { homeConfigPath, writeHomeConfig } from "../../src/connector/home.js";
import { writeRepoConfig } from "../../src/connector/repo.js";
import {
  LEDGER_SCHEMA,
  readGrounderState,
  setLedgerFileHash,
  statePath,
  writeGrounderState,
} from "../../src/connector/state.js";
import { VERSION } from "../../src/index.js";
import { hashContent } from "../../src/util/hash.js";
import { captureStdout, createTempEnv } from "../helpers.js";

describe("commands/status", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("prints linked snapshot with machine and project sections", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Machine\n");
    expect(out).toContain(`  Config:     ${homeConfigPath(env.home)}`);
    expect(out).toContain(`  Vault:      ${env.vault}`);
    expect(out).toContain(`  State:      ${statePath(env.home)}`);
    expect(out).not.toContain("Package:");
    expect(out).toContain("  Install:    current");
    expect(out).toContain("Project\n");
    expect(out).toContain("  Linked:     yes");
    expect(out).toContain(`  Folder:     ${env.repo}`);
    expect(out).toContain(`  Config:     ${path.join(env.repo, ".grounder.json")}`);
    expect(out).toContain("  Id:         my-app");
    expect(out).toContain(
      `  Notes:      ${path.join(env.vault, "10-Projects", "my-app", "notes")}`,
    );
    expect(out).toContain(`  Logs:       ${path.join(env.vault, "10-Projects", "my-app", "logs")}`);
    expect(out).toContain(
      `  Plans:      ${path.join(env.vault, "10-Projects", "my-app", "plans")}`,
    );
    expect(out).toContain(`  Git:        ${env.repo}`);
  });

  it("reports missing install state when vault is configured but state.json is absent", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    const { rm } = await import("node:fs/promises");
    await rm(statePath(env.home), { force: true });

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain(`  Vault:      ${env.vault}`);
    expect(out).toContain("  State:      missing → grounder migrate --force");
  });

  it("flags an ancestor link when cwd is an unlinked subdirectory of a linked repo", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const subdir = path.join(env.repo, "fixtures", "dev");
    await mkdir(subdir, { recursive: true });

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: subdir, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("  Linked:     yes");
    expect(out).toContain(`  Folder:     ${env.repo}`);
    expect(out).toContain(
      `  Note:       linked ancestor — ${subdir} itself is unlinked; grounder link here would create a separate project`,
    );
    expect(out).toContain("  Id:         my-app");
  });

  it("reports package lag when grounderVersion is behind the running package", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    // Only the version lags — file hashes still match the current templates,
    // so `Install:` (content drift) must stay independent of `Package:`.
    const state = await readGrounderState(env.home);
    if (!state) {
      throw new Error("expected install state after setup");
    }
    await writeGrounderState({ ...state, grounderVersion: "0.1.0" }, env.home);

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain(`  State:      ${statePath(env.home)}`);
    expect(out).toContain("  Package:    configuration outdated — run: grounder migrate");
    expect(out).toContain("  Install:    current");
    expect(VERSION).not.toBe("0.1.0");
  });

  it("reports when the running package is older than the ledger", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    const state = await readGrounderState(env.home);
    if (!state) {
      throw new Error("expected install state after setup");
    }
    await writeGrounderState({ ...state, grounderVersion: "99.0.0" }, env.home);

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("  Package:    older than configuration — install a newer Grounder");
  });

  it("reports install drift when the ledger has an agent entry but no recorded file hashes", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await writeGrounderState(
      {
        ledgerSchema: LEDGER_SCHEMA,
        grounderVersion: VERSION,
        agents: {
          cursor: { files: {} },
        },
      },
      env.home,
    );

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain(`  State:      ${statePath(env.home)}`);
    expect(out).not.toContain("Package:");
    expect(out).toContain("  Install:    outdated → grounder migrate");
  });

  it("reports install drift when a tombstoned legacy path is still recorded in the ledger", async () => {
    // Simulates the leftover doctor's agent-cursor-legacy-commands check
    // catches (a schema-3→4 upgrade that hasn't retired the old command file
    // yet) — status must not claim "current" while a plain `migrate` still
    // has that path to retire (delete, forget, or a conflict).
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    const legacyPath = path.join(env.home, ".cursor", "commands", "grounder-note.md");
    const legacyContent = "old pre-skill note command\n";
    await setLedgerFileHash({
      agentId: "cursor",
      filePath: legacyPath,
      hash: hashContent(legacyContent),
      grounderVersion: "0.5.0",
      homeDir: env.home,
    });

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("  Install:    outdated → grounder migrate");
  });

  it("reports unsupported ledger schema without suggesting migrate --force", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    const state = await readGrounderState(env.home);
    if (!state) {
      throw new Error("expected install state after setup");
    }
    await writeGrounderState({ ...state, ledgerSchema: LEDGER_SCHEMA + 1 }, env.home);

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("  State:      unsupported → upgrade grounder");
    expect(out).not.toContain("grounder migrate --force");
  });

  it("reports missing vault when neither vault nor project is configured", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Machine\n");
    expect(out).toContain("  Config:     missing → grounder setup <path>");
    expect(out).not.toContain("Vault:");
    expect(out).not.toContain("State:");
    expect(out).toContain("Project\n");
    expect(out).toContain("  Linked:     no");
    expect(out).not.toContain("incomplete");
  });

  it("reports linked when project config exists but vault does not", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await writeRepoConfig(env.repo, { version: 1, projectId: "my-app" });

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("  Config:     missing → grounder setup <path>");
    expect(out).toContain("  Linked:     yes");
    expect(out).toContain(`  Folder:     ${env.repo}`);
    expect(out).toContain(`  Config:     ${path.join(env.repo, ".grounder.json")}`);
    expect(out).toContain("  Id:         my-app");
    expect(out).not.toContain("incomplete");
    expect(out).not.toContain("Notes:");
    expect(out).not.toContain("Logs:");
    expect(out).not.toContain("Plans:");
  });

  it("reports missing project config when vault exists but not linked", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    process.env.GROUNDER_HOME = env.home;
    await writeHomeConfig({ vaultRoot: env.vault });

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Machine\n");
    expect(out).toContain(`  Config:     ${homeConfigPath(env.home)}`);
    expect(out).toContain(`  Vault:      ${env.vault}`);
    expect(out).toContain("  State:      missing → grounder migrate --force");
    expect(out).toContain("Project\n");
    expect(out).toContain("  Linked:     no");
    expect(out).toContain("  Config:     missing → grounder link");
  });

  it("reports invalid home config without aborting", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await mkdir(path.dirname(homeConfigPath(env.home)), { recursive: true });
    await writeFile(homeConfigPath(env.home), "{not-json", "utf8");
    await writeRepoConfig(env.repo, { version: 1, projectId: "my-app" });

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("  Config:     invalid → grounder setup <path>");
    expect(out).not.toContain("Vault:");
    expect(out).not.toContain("State:");
    expect(out).toContain("  Linked:     yes");
    expect(out).toContain(`  Folder:     ${env.repo}`);
    expect(out).toContain("  Id:         my-app");
    expect(out).not.toContain("incomplete");
  });

  it("reports invalid repo config without aborting", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await writeFile(path.join(env.repo, ".grounder.json"), '{"version":1}\n', "utf8");

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain(`  Config:     ${homeConfigPath(env.home)}`);
    expect(out).toContain(`  Vault:      ${env.vault}`);
    expect(out).toContain("  Linked:     incomplete → grounder link --force");
    expect(out).toContain(`  Folder:     ${env.repo}`);
    expect(out).toContain("  Config:     invalid → grounder link --force");
    expect(out).not.toContain("Notes:");
    expect(out).not.toContain("Plans:");
    expect(out).not.toContain("Id:");
  });

  it("reports unsupported repo config version without suggesting reinit", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await writeFile(
      path.join(env.repo, ".grounder.json"),
      `${JSON.stringify({ version: 2, projectId: "my-app" }, null, 2)}\n`,
      "utf8",
    );

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("  Linked:     unsupported → upgrade grounder");
    expect(out).toContain("  Config:     unsupported → upgrade grounder");
    expect(out).not.toContain("grounder link --force");
    expect(out).not.toContain("Notes:");
  });
});
