import path from "node:path";
import { execSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import {
  findLinkedRepoRoot,
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

  it("finds linked folder walking up from cwd", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const packageDir = path.join(env.repo, "packages", "child-app");
    await mkdir(packageDir, { recursive: true });
    await writeRepoConfig(packageDir, { version: 1, projectId: "child-app" });

    const nested = path.join(packageDir, "src", "nested");
    await mkdir(nested, { recursive: true });

    expect(await findLinkedRepoRoot(nested, null)).toBe(packageDir);
  });

  it("stops walk at git root without crossing into parent folders", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    execSync("git init", { cwd: env.repo, stdio: "ignore" });
    await writeRepoConfig(path.dirname(env.repo), {
      version: 1,
      projectId: "outside",
    });

    const nested = path.join(env.repo, "src");
    await mkdir(nested, { recursive: true });

    expect(await findLinkedRepoRoot(nested, env.repo)).toBeNull();
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
