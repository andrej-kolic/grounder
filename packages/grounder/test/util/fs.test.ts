import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileExists, isExecutable } from "../../src/util/fs.js";
import { createTempEnv } from "../helpers.js";

describe("util/fs", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  describe("fileExists", () => {
    it("is true for an existing file and false when missing", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      const filePath = path.join(env.home, "present.txt");
      await writeFile(filePath, "ok\n");

      expect(await fileExists(filePath)).toBe(true);
      expect(await fileExists(path.join(env.home, "missing.txt"))).toBe(false);
    });
  });

  describe("isExecutable", () => {
    it("is false when the path is missing", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      expect(await isExecutable(path.join(env.home, "no-such-bin"))).toBe(false);
    });

    it.skipIf(process.platform === "win32")(
      "is true for an executable file and false without the execute bit",
      async () => {
        const env = await createTempEnv({ initGit: false });
        cleanup = env.cleanup;
        await mkdir(env.home, { recursive: true });

        const execPath = path.join(env.home, "run-me");
        const plainPath = path.join(env.home, "read-me");
        await writeFile(execPath, "#!/bin/sh\n");
        await writeFile(plainPath, "#!/bin/sh\n");
        await chmod(execPath, 0o755);
        await chmod(plainPath, 0o644);

        expect(await isExecutable(execPath)).toBe(true);
        expect(await fileExists(plainPath)).toBe(true);
        expect(await isExecutable(plainPath)).toBe(false);
      },
    );
  });
});
