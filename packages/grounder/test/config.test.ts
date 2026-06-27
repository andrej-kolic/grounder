import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  homeConfigPath,
  readHomeConfig,
  readRepoConfig,
  repoConfigPath,
  resolveVaultRoot,
  writeHomeConfig,
  writeRepoConfig,
} from "../src/config.js";
import { resolveNotesDir } from "../src/paths.js";
import { createTempEnv } from "./helpers.js";

describe("config", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("reads and writes home config", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const previousHome = process.env.GROUNDER_HOME;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });
    const config = await readHomeConfig();

    expect(config).toEqual({ vaultRoot: env.vault });
    expect(homeConfigPath()).toBe(path.join(env.home, ".grounder", "config.json"));

    process.env.GROUNDER_HOME = previousHome;
  });

  it("reads and writes repo config", async () => {
    const env = await createTempEnv();
    cleanup = env.cleanup;

    await writeRepoConfig(env.repo, { version: 1, projectId: "my-app" });
    const config = await readRepoConfig(env.repo);

    expect(config).toEqual({ version: 1, projectId: "my-app" });
    expect(repoConfigPath(env.repo)).toBe(path.join(env.repo, ".grounder.json"));
  });

  it("uses GROUNDER_VAULT env override", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const overrideVault = path.join(env.home, "override-vault");

    process.env.GROUNDER_HOME = env.home;
    process.env.GROUNDER_VAULT = overrideVault;
    await writeHomeConfig({ vaultRoot: env.vault });

    const resolved = resolveVaultRoot({ vaultRoot: env.vault });
    expect(resolved).toBe(path.resolve(overrideVault));

    delete process.env.GROUNDER_VAULT;
  });

  it("resolves notes dir from home and repo config", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const home = { vaultRoot: env.vault };
    const repo = { version: 1 as const, projectId: "my-app" };

    expect(resolveNotesDir(home, repo)).toBe(
      path.join(env.vault, "10-Projects", "my-app", "notes"),
    );
  });
});
