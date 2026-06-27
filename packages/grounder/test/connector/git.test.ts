import { afterEach, describe, expect, it } from "vitest";
import { findGitRoot } from "../../src/connector/git.js";
import { createTempEnv } from "../helpers.js";
import path from "node:path";

describe("connector/git", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("finds git root in temp repo", async () => {
    const env = await createTempEnv({ packageName: "fixture-app" });
    cleanup = env.cleanup;

    const nested = path.join(env.repo, "src", "nested");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(nested, { recursive: true }));

    expect(await findGitRoot(nested)).toBe(env.repo);
  });

  it("returns null outside git repo", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    expect(await findGitRoot(env.repo)).toBeNull();
  });
});
