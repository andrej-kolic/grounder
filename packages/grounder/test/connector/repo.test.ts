import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readRepoConfig,
  repoConfigPath,
  writeRepoConfig,
} from "../../src/connector/repo.js";
import { createTempEnv } from "../helpers.js";

describe("connector/repo", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("reads and writes repo config", async () => {
    const env = await createTempEnv();
    cleanup = env.cleanup;

    await writeRepoConfig(env.repo, { version: 1, projectId: "my-app" });
    const config = await readRepoConfig(env.repo);

    expect(config).toEqual({ version: 1, projectId: "my-app" });
    expect(repoConfigPath(env.repo)).toBe(path.join(env.repo, ".grounder.json"));
  });
});
