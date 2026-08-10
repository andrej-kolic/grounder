import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRepoInitWithOptions } from "../../src/commands/repo/init.js";
import { runStatusWithOptions } from "../../src/commands/status.js";
import { runVaultInitWithOptions } from "../../src/commands/vault/init.js";
import { homeConfigPath, writeHomeConfig } from "../../src/connector/home.js";
import { writeRepoConfig } from "../../src/connector/repo.js";
import { statePath, writeGrounderState } from "../../src/connector/state.js";
import { VERSION } from "../../src/index.js";
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

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Machine\n");
    expect(out).toContain(`  Config:     ${homeConfigPath(env.home)}`);
    expect(out).toContain(`  Vault:      ${env.vault}`);
    expect(out).toContain(`  State:      ${statePath(env.home)}`);
    expect(out).not.toContain("Package:");
    expect(out).not.toContain("Schemas:");
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

    await runVaultInitWithOptions({
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

  it("reports package lag when grounderVersion is behind the running package", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await writeGrounderState(
      {
        grounderVersion: "0.1.0",
        agents: {
          cursor: { commandsSchema: 2, hooksSchema: 1, files: {} },
        },
      },
      env.home,
    );

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain(`  State:      ${statePath(env.home)}`);
    expect(out).toContain("  Package:    configuration outdated — run: grounder migrate");
    expect(out).not.toContain("Schemas:");
    expect(VERSION).not.toBe("0.1.0");
  });

  it("reports when the running package is older than the ledger", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await writeGrounderState(
      {
        grounderVersion: "99.0.0",
        agents: {
          cursor: { commandsSchema: 2, hooksSchema: 1, files: {} },
        },
      },
      env.home,
    );

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("  Package:    older than configuration — install a newer Grounder");
  });

  it("reports schema lag when recorded schemas are behind adapters", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await writeGrounderState(
      {
        grounderVersion: VERSION,
        agents: {
          cursor: { commandsSchema: 0, files: {} },
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
    expect(out).toContain("  Schemas:    stale → grounder migrate");
  });

  it("reports missing vault when neither vault nor project is configured", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Machine\n");
    expect(out).toContain("  Config:     missing → grounder vault init <path>");
    expect(out).not.toContain("Vault:");
    expect(out).not.toContain("State:");
    expect(out).toContain("Project\n");
    expect(out).toContain("  Linked:     no");
    expect(out).not.toContain("incomplete");
  });

  it("reports incomplete when project config exists but vault does not", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await writeRepoConfig(env.repo, { version: 1, projectId: "my-app" });

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("  Config:     missing → grounder vault init <path>");
    expect(out).toContain("  Linked:     incomplete → grounder vault init <path>");
    expect(out).toContain(`  Folder:     ${env.repo}`);
    expect(out).toContain(`  Config:     ${path.join(env.repo, ".grounder.json")}`);
    expect(out).toContain("  Id:         my-app");
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
    expect(out).toContain("  Config:     missing → grounder init");
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
    expect(out).toContain("  Config:     invalid → grounder vault init <path>");
    expect(out).not.toContain("Vault:");
    expect(out).not.toContain("State:");
    expect(out).toContain("  Linked:     incomplete → grounder vault init <path>");
    expect(out).toContain(`  Folder:     ${env.repo}`);
    expect(out).toContain("  Id:         my-app");
  });

  it("reports invalid repo config without aborting", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await writeFile(path.join(env.repo, ".grounder.json"), '{"version":1}\n', "utf8");

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain(`  Config:     ${homeConfigPath(env.home)}`);
    expect(out).toContain(`  Vault:      ${env.vault}`);
    expect(out).toContain("  Linked:     incomplete → grounder init --force");
    expect(out).toContain(`  Folder:     ${env.repo}`);
    expect(out).toContain("  Config:     invalid → grounder init --force");
    expect(out).not.toContain("Notes:");
    expect(out).not.toContain("Plans:");
    expect(out).not.toContain("Id:");
  });

  it("reports unsupported repo config version without suggesting reinit", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
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
    expect(out).not.toContain("grounder init --force");
    expect(out).not.toContain("Notes:");
  });
});
