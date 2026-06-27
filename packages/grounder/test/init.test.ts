import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRepoConfig, writeHomeConfig } from "../src/config.js";
import { runInitWithOptions } from "../src/commands/init.js";
import { createTempEnv } from "./helpers.js";

describe("init", () => {
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

  it("writes repo marker and creates notes folder", async () => {
    const env = await setupLinkedEnv();
    cleanup = env.cleanup;

    const code = await runInitWithOptions({
      cwd: env.repo,
      yes: true,
      homeDir: env.home,
    });

    expect(code).toBe(0);
    expect(await readRepoConfig(env.repo)).toEqual({ version: 1, projectId: "my-app" });
    const { access } = await import("node:fs/promises");
    await access(path.join(env.vault, "10-Projects", "my-app", "notes"));
  });

  it("is safe to run twice", async () => {
    const env = await setupLinkedEnv();
    cleanup = env.cleanup;

    await runInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    const code = await runInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    expect(code).toBe(0);
    expect(await readRepoConfig(env.repo)).toEqual({ version: 1, projectId: "my-app" });
  });

  it("overwrites marker with --force", async () => {
    const env = await setupLinkedEnv("old-name");
    cleanup = env.cleanup;

    await runInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    const code = await runInitWithOptions({
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

    const code = await runInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    expect(code).toBe(1);
  });
});
