import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRepoInitWithOptions } from "../../../src/commands/repo/init.js";
import { writeHomeConfig } from "../../../src/connector/home.js";
import { readRepoConfig } from "../../../src/connector/repo.js";
import { createTempEnv } from "../../helpers.js";

describe("commands/repo/init", () => {
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

  it("writes repo marker and creates notes and logs folders", async () => {
    const env = await setupLinkedEnv();
    cleanup = env.cleanup;

    const code = await runRepoInitWithOptions({
      cwd: env.repo,
      yes: true,
      homeDir: env.home,
    });

    expect(code).toBe(0);
    expect(await readRepoConfig(env.repo)).toEqual({ version: 1, projectId: "my-app" });
    const { access } = await import("node:fs/promises");
    await access(path.join(env.vault, "10-Projects", "my-app", "notes"));
    await access(path.join(env.vault, "10-Projects", "my-app", "logs"));
  });

  it("is safe to run twice", async () => {
    const env = await setupLinkedEnv();
    cleanup = env.cleanup;

    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    const code = await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    expect(code).toBe(0);
    expect(await readRepoConfig(env.repo)).toEqual({ version: 1, projectId: "my-app" });
  });

  it("overwrites marker with --force", async () => {
    const env = await setupLinkedEnv("old-name");
    cleanup = env.cleanup;

    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    const code = await runRepoInitWithOptions({
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

    const code = await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
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

    const code = await runRepoInitWithOptions({
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

    const code = await runRepoInitWithOptions({
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
