import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveNotesDir, resolveProjectDir, resolveProjectsParent } from "../src/paths.js";
import { createTempEnv } from "./helpers.js";

describe("paths", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("resolves project and notes directories", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    expect(resolveProjectsParent(env.vault)).toBe(path.join(env.vault, "10-Projects"));
    expect(resolveProjectDir(env.vault, "my-app")).toBe(
      path.join(env.vault, "10-Projects", "my-app"),
    );
    expect(
      resolveNotesDir({ vaultRoot: env.vault }, { version: 1, projectId: "my-app" }),
    ).toBe(path.join(env.vault, "10-Projects", "my-app", "notes"));
  });
});
