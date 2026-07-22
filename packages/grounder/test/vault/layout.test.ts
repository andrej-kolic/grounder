import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { logsDir, notesDir, projectDir, projectsParent } from "../../src/vault/layout.js";
import { createTempEnv } from "../helpers.js";

describe("vault/layout", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("builds vault paths from vault root and project id", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    expect(projectsParent(env.vault)).toBe(path.join(env.vault, "10-Projects"));
    expect(projectDir(env.vault, "my-app")).toBe(
      path.join(env.vault, "10-Projects", "my-app"),
    );
    expect(notesDir(env.vault, "my-app")).toBe(
      path.join(env.vault, "10-Projects", "my-app", "notes"),
    );
    expect(logsDir(env.vault, "my-app")).toBe(
      path.join(env.vault, "10-Projects", "my-app", "logs"),
    );
  });
});
