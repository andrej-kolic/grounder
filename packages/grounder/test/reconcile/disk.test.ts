import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDiskHashes } from "../../src/reconcile/disk.js";
import { hashContent } from "../../src/util/hash.js";
import { createTempEnv } from "../helpers.js";

describe("reconcile/disk - readDiskHashes", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("hashes a present file's content", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const filePath = path.join(env.home, "note.md");
    await writeFile(filePath, "hello\n", "utf8");

    const hashes = await readDiskHashes([filePath]);

    expect(hashes[filePath]).toBe(hashContent("hello\n"));
  });

  it("maps a missing path to undefined without throwing", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const filePath = path.join(env.home, "does-not-exist.md");

    const hashes = await readDiskHashes([filePath]);

    expect(hashes[filePath]).toBeUndefined();
  });

  it("propagates a non-ENOENT read failure instead of treating it as missing", async () => {
    // A directory in place of the expected file — readFile() on it fails
    // with EISDIR, never ENOENT, without needing to mock node:fs/promises.
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const dirAsFilePath = path.join(env.home, "actually-a-dir.md");
    await mkdir(dirAsFilePath, { recursive: true });

    await expect(readDiskHashes([dirAsFilePath])).rejects.toThrow();
  });
});
