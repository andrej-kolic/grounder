import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeHomeConfig } from "../../src/connector/home.js";
import { resolveNotesDir, resolveVaultRoot } from "../../src/connector/vault.js";
import { createTempEnv } from "../helpers.js";

describe("connector/vault", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
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
