import { execSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { currentBranch, findGitRoot } from "../../src/connector/git.js";
import { createTempEnv } from "../helpers.js";

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

  it("returns current branch for a git repo", async () => {
    const env = await createTempEnv();
    cleanup = env.cleanup;

    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(env.repo, "README.md"), "hi\n", "utf8");
    execSync("git add README.md", { cwd: env.repo, stdio: "ignore" });
    execSync('git commit -m "init"', { cwd: env.repo, stdio: "ignore" });
    execSync("git checkout -b feature/handoff", { cwd: env.repo, stdio: "ignore" });

    expect(await currentBranch(env.repo)).toBe("feature/handoff");
  });

  it("returns undefined outside a git repo", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    expect(await currentBranch(env.repo)).toBeUndefined();
  });

  it("returns undefined on detached HEAD", async () => {
    const env = await createTempEnv();
    cleanup = env.cleanup;

    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(env.repo, "README.md"), "hi\n", "utf8");
    execSync("git add README.md", { cwd: env.repo, stdio: "ignore" });
    execSync('git commit -m "init"', { cwd: env.repo, stdio: "ignore" });
    execSync("git checkout --detach HEAD", { cwd: env.repo, stdio: "ignore" });

    expect(await currentBranch(env.repo)).toBeUndefined();
  });
});
