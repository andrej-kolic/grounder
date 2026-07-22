import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mkdir } from "node:fs/promises";
import { resolveLinkedProject } from "../../src/connector/linked.js";
import { writeHomeConfig, withHomeDir } from "../../src/connector/home.js";
import { writeRepoConfig } from "../../src/connector/repo.js";
import { createTempEnv } from "../helpers.js";

describe("connector/linked", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("returns no-vault when home config is missing", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await withHomeDir(env.home, async () => {
      const result = await resolveLinkedProject(env.repo);
      expect(result).toEqual({ ok: false, error: "no-vault" });
    });
  });

  it("returns not-linked when marker is missing", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await withHomeDir(env.home, async () => {
      await writeHomeConfig({ vaultRoot: env.vault });
      const result = await resolveLinkedProject(env.repo);
      expect(result).toEqual({ ok: false, error: "not-linked" });
    });
  });

  it("resolves home + repo from a nested cwd", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await withHomeDir(env.home, async () => {
      await writeHomeConfig({ vaultRoot: env.vault });
      await writeRepoConfig(env.repo, { version: 1, projectId: "my-app" });

      const nested = path.join(env.repo, "src", "nested");
      await mkdir(nested, { recursive: true });

      const result = await resolveLinkedProject(nested);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.value.home).toEqual({ vaultRoot: env.vault });
      expect(result.value.repo).toEqual({ version: 1, projectId: "my-app" });
      expect(result.value.linkedRoot).toBe(env.repo);
      expect(result.value.gitRoot).toBe(env.repo);
    });
  });
});
