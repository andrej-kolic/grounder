import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLinkWithOptions } from "../../src/commands/link.js";
import { writeHomeConfig } from "../../src/connector/home.js";
import { readRepoConfig, repoConfigPath } from "../../src/connector/repo.js";
import { fileExists } from "../../src/util/fs.js";
import { captureStdout, createTempEnv } from "../helpers.js";

describe("commands/link", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  async function setupLinkedEnv(packageName = "my-app") {
    const env = await createTempEnv({ packageName });
    process.env.GROUNDER_HOME = env.home;
    await writeHomeConfig({ vaultRoot: env.vault });
    return env;
  }

  it("dry-run previews writes without creating the marker or vault folders", async () => {
    const env = await setupLinkedEnv();
    cleanup = env.cleanup;

    const { code, out } = await captureStdout(() =>
      runLinkWithOptions({
        cwd: env.repo,
        dryRun: true,
        homeDir: env.home,
      }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Link this project inside the markdown vault (once per project).");
    expect(out).toContain("Would create:");
    expect(out).not.toContain("Dry run");
    expect(out).not.toContain("Will create:");
    expect(
      out.indexOf("Link this project inside the markdown vault (once per project)."),
    ).toBeLessThan(out.indexOf("Would create:"));
    expect(out).toContain(`link   ${repoConfigPath(env.repo)}`);
    expect(out).toContain("vault  10-Projects/my-app/notes/");
    expect(out).toContain("vault  10-Projects/my-app/logs/");
    expect(out).toContain("vault  10-Projects/my-app/plans/");
    expect(out).not.toContain("✓ Wrote .grounder.json");

    expect(await readRepoConfig(env.repo)).toBeNull();
    expect(await fileExists(path.join(env.vault, "10-Projects", "my-app", "notes"))).toBe(false);
    expect(await fileExists(path.join(env.vault, "10-Projects", "my-app", "logs"))).toBe(false);
    expect(await fileExists(path.join(env.vault, "10-Projects", "my-app", "plans"))).toBe(false);
  });

  it("dry-run still errors when the folder is linked as a different project id", async () => {
    const env = await setupLinkedEnv("old-name");
    cleanup = env.cleanup;

    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    const code = await runLinkWithOptions({
      cwd: env.repo,
      dryRun: true,
      id: "new-id",
      homeDir: env.home,
    });

    expect(code).toBe(1);
    expect(await readRepoConfig(env.repo)).toEqual({ version: 1, projectId: "old-name" });
  });

  it("writes repo marker and creates notes, logs, and plans folders", async () => {
    const env = await setupLinkedEnv();
    cleanup = env.cleanup;

    const code = await runLinkWithOptions({
      cwd: env.repo,
      yes: true,
      homeDir: env.home,
    });

    expect(code).toBe(0);
    expect(await readRepoConfig(env.repo)).toEqual({ version: 1, projectId: "my-app" });
    const { access } = await import("node:fs/promises");
    await access(path.join(env.vault, "10-Projects", "my-app", "notes"));
    await access(path.join(env.vault, "10-Projects", "my-app", "logs"));
    await access(path.join(env.vault, "10-Projects", "my-app", "plans"));
  });

  it("is safe to run twice", async () => {
    const env = await setupLinkedEnv();
    cleanup = env.cleanup;

    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    const { code, out } = await captureStdout(() =>
      runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("✓ Already linked (skipped)");
    expect(out).not.toContain("Will create:");
    expect(out).not.toContain("✓ Wrote .grounder.json");
    expect(await readRepoConfig(env.repo)).toEqual({ version: 1, projectId: "my-app" });
  });

  it("dry-run reports already linked instead of would-create", async () => {
    const env = await setupLinkedEnv();
    cleanup = env.cleanup;

    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    const { code, out } = await captureStdout(() =>
      runLinkWithOptions({
        cwd: env.repo,
        dryRun: true,
        homeDir: env.home,
      }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Already linked (would skip).");
    expect(out).not.toContain("Would create:");
    expect(out).not.toContain("Link this project inside the markdown vault (once per project).");
    expect(out).not.toContain(`link   ${repoConfigPath(env.repo)}`);
  });

  it("dry-run with --force still previews overwrite when already linked", async () => {
    const env = await setupLinkedEnv();
    cleanup = env.cleanup;

    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    const { code, out } = await captureStdout(() =>
      runLinkWithOptions({
        cwd: env.repo,
        dryRun: true,
        force: true,
        homeDir: env.home,
      }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Would create:");
    expect(out).toContain(`link   ${repoConfigPath(env.repo)}`);
    expect(out).not.toContain("Already linked (would skip).");
  });

  it("overwrites marker with --force", async () => {
    const env = await setupLinkedEnv("old-name");
    cleanup = env.cleanup;

    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    const code = await runLinkWithOptions({
      cwd: env.repo,
      yes: true,
      force: true,
      id: "new-id",
      homeDir: env.home,
    });

    expect(code).toBe(0);
    expect(await readRepoConfig(env.repo)).toEqual({ version: 1, projectId: "new-id" });
  });

  it("fails without home config", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    const code = await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    expect(code).toBe(1);
  });

  it("writes marker in cwd, not git root, when run from a subfolder", async () => {
    const env = await createTempEnv({ initGit: false, packageName: "root-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;
    await writeHomeConfig({ vaultRoot: env.vault });

    execSync("git init", { cwd: env.repo, stdio: "ignore" });

    const packageDir = path.join(env.repo, "packages", "child-app");
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, "package.json"),
      `${JSON.stringify({ name: "child-app" }, null, 2)}\n`,
    );

    const code = await runLinkWithOptions({
      cwd: packageDir,
      yes: true,
      homeDir: env.home,
    });

    expect(code).toBe(0);
    expect(await readRepoConfig(packageDir)).toEqual({
      version: 1,
      projectId: "child-app",
    });
    expect(await readRepoConfig(env.repo)).toBeNull();
  });

  it("works without git when project id is provided", async () => {
    const env = await createTempEnv({ initGit: false, packageName: undefined });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;
    await writeHomeConfig({ vaultRoot: env.vault });

    const code = await runLinkWithOptions({
      cwd: env.repo,
      yes: true,
      id: "my-folder",
      homeDir: env.home,
    });

    expect(code).toBe(0);
    expect(await readRepoConfig(env.repo)).toEqual({
      version: 1,
      projectId: "my-folder",
    });
  });
});
