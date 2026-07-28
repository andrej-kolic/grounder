import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runRepoInitWithOptions } from "../../src/commands/repo/init.js";
import { runStatusWithOptions } from "../../src/commands/status.js";
import { runVaultInitWithOptions } from "../../src/commands/vault/init.js";
import { homeConfigPath, writeHomeConfig } from "../../src/connector/home.js";
import { writeRepoConfig } from "../../src/connector/repo.js";
import { createTempEnv } from "../helpers.js";

async function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    const code = await fn();
    return { code, out: chunks.join("") };
  } finally {
    spy.mockRestore();
  }
}

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

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Machine\n");
    expect(out).toContain(`  Config:     ${homeConfigPath(env.home)}`);
    expect(out).toContain(`  Vault:      ${env.vault}`);
    expect(out).toContain("Project\n");
    expect(out).toContain("  Linked:     yes");
    expect(out).toContain(`  Folder:     ${env.repo}`);
    expect(out).toContain(`  Config:     ${path.join(env.repo, ".grounder.json")}`);
    expect(out).toContain("  Id:         my-app");
    expect(out).toContain(
      `  Notes:      ${path.join(env.vault, "10-Projects", "my-app", "notes")}`,
    );
    expect(out).toContain(`  Logs:       ${path.join(env.vault, "10-Projects", "my-app", "logs")}`);
    expect(out).toContain(`  Git:        ${env.repo}`);
  });

  it("reports missing vault when neither vault nor project is configured", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    const { code, out } = await captureStdout(() =>
      runStatusWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Machine\n");
    expect(out).toContain("  Config:     missing → run: grounder vault init <path>");
    expect(out).not.toContain("Vault:");
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
    expect(out).toContain("  Config:     missing → run: grounder vault init <path>");
    expect(out).toContain("  Linked:     incomplete → run: grounder vault init <path>");
    expect(out).toContain(`  Folder:     ${env.repo}`);
    expect(out).toContain(`  Config:     ${path.join(env.repo, ".grounder.json")}`);
    expect(out).toContain("  Id:         my-app");
    expect(out).not.toContain("Notes:");
    expect(out).not.toContain("Logs:");
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
    expect(out).toContain("Project\n");
    expect(out).toContain("  Linked:     no");
    expect(out).toContain("  Config:     missing → run: grounder init");
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
    expect(out).toContain("  Config:     invalid → run: grounder vault init <path>");
    expect(out).not.toContain("Vault:");
    expect(out).toContain("  Linked:     incomplete → run: grounder vault init <path>");
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
    expect(out).toContain("  Linked:     incomplete → run: grounder init --force");
    expect(out).toContain(`  Folder:     ${env.repo}`);
    expect(out).toContain("  Config:     invalid → run: grounder init --force");
    expect(out).not.toContain("Notes:");
    expect(out).not.toContain("Id:");
  });
});
