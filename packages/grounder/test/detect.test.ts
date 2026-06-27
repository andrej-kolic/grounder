import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { detectProjectId, findGitRoot } from "../src/detect.js";
import { createTempEnv } from "./helpers.js";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/minimal-git-repo",
);

describe("detect", () => {
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

  it("detects project id from package.json", async () => {
    const env = await createTempEnv({ packageName: "My_App" });
    cleanup = env.cleanup;

    const detected = await detectProjectId(env.repo);
    expect(detected).toEqual({ id: "my-app", source: "package.json" });
  });

  it("detects project id from git remote slug", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(path.join(env.repo, ".git"), { recursive: true }),
    );
    await writeFile(
      path.join(env.repo, ".git", "config"),
      `[remote "origin"]\n\turl = git@github.com:acme/cool-project.git\n`,
    );

    const detected = await detectProjectId(env.repo);
    expect(detected).toEqual({ id: "cool-project", source: "git-remote" });
  });

  it("detects project id from repo basename", async () => {
    const env = await createTempEnv({ initGit: false, packageName: undefined });
    cleanup = env.cleanup;

    const detected = await detectProjectId(env.repo);
    expect(detected.source).toBe("basename");
    expect(detected.id).toBe("repo");
  });

  it("respects --id override", async () => {
    const env = await createTempEnv({ packageName: "ignored" });
    cleanup = env.cleanup;

    const detected = await detectProjectId(env.repo, "Custom_ID");
    expect(detected).toEqual({ id: "custom-id", source: "flag" });
  });

  it("works with minimal-git-repo fixture package name", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await writeFile(
      path.join(env.repo, "package.json"),
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(path.join(fixtureRoot, "package.json"), "utf8"),
      ),
    );

    const detected = await detectProjectId(env.repo);
    expect(detected).toEqual({ id: "minimal-app", source: "package.json" });
  });
});
