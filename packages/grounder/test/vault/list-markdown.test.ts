import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listMarkdownFiles } from "../../src/vault/list-markdown.js";
import { createTempEnv } from "../helpers.js";

describe("vault/list-markdown", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("returns empty array when dir is missing", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    expect(await listMarkdownFiles(path.join(env.vault, "missing"))).toEqual([]);
  });

  it("walks nested directories and skips non-markdown", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const root = path.join(env.vault, "plans");
    const nested = path.join(root, "migration", "phase");
    await mkdir(nested, { recursive: true });
    const a = path.join(root, "a.md");
    const b = path.join(nested, "b.md");
    await writeFile(a, "a", "utf8");
    await writeFile(b, "b", "utf8");
    await writeFile(path.join(nested, "skip.txt"), "no", "utf8");

    const found = await listMarkdownFiles(root);
    expect(found.sort()).toEqual([a, b].sort());
  });
});
