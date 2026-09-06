import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listHandoffs, listHandoffsDetailed } from "../../src/vault/list-handoffs.js";
import { createTempEnv } from "../helpers.js";

async function touch(filePath: string, when: Date): Promise<void> {
  await utimes(filePath, when, when);
}

describe("vault/list-handoffs", () => {
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
    const logsDir = path.join(env.vault, "missing-logs");

    expect(await listHandoffs(logsDir)).toEqual([]);
  });

  it("returns empty array when dir is empty", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");
    await mkdir(logsDir, { recursive: true });

    expect(await listHandoffs(logsDir)).toEqual([]);
  });

  it("sorts markdown files newest-first by filename", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(path.join(logsDir, "2026-06-26-143000.md"), "a", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-150000-later.md"), "b", "utf8");
    await writeFile(path.join(logsDir, "2026-06-25-090000-old.md"), "c", "utf8");
    await writeFile(path.join(logsDir, "readme.txt"), "skip", "utf8");

    expect(await listHandoffs(logsDir)).toEqual([
      path.join(logsDir, "2026-06-26-150000-later.md"),
      path.join(logsDir, "2026-06-26-143000.md"),
      path.join(logsDir, "2026-06-25-090000-old.md"),
    ]);
  });

  it("listHandoffsDetailed returns the same filename ranking with each entry's real mtime attached", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");
    await mkdir(logsDir, { recursive: true });
    const later = path.join(logsDir, "2026-06-26-150000-later.md");
    const earlier = path.join(logsDir, "2026-06-26-143000.md");
    await writeFile(later, "a", "utf8");
    await writeFile(earlier, "b", "utf8");
    // mtime intentionally reversed from filename order — ranking must stay
    // filename-based, only the mtime field itself should reflect this.
    const laterMtime = new Date("2026-06-25T09:00:00.000Z");
    const earlierMtime = new Date("2026-06-27T09:00:00.000Z");
    await touch(later, laterMtime);
    await touch(earlier, earlierMtime);

    expect(await listHandoffsDetailed(logsDir)).toEqual([
      { path: later, mtimeMs: laterMtime.getTime() },
      { path: earlier, mtimeMs: earlierMtime.getTime() },
    ]);
  });

  it("lists _NN collision suffixes newest-first (not the unsuffixed base)", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(path.join(logsDir, "2026-06-26-143000-dup.md"), "first", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-143000-dup_02.md"), "second", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-143000-dup_10.md"), "tenth", "utf8");

    expect(await listHandoffs(logsDir)).toEqual([
      path.join(logsDir, "2026-06-26-143000-dup_10.md"),
      path.join(logsDir, "2026-06-26-143000-dup_02.md"),
      path.join(logsDir, "2026-06-26-143000-dup.md"),
    ]);
  });

  it("applies limit (newest first)", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(path.join(logsDir, "2026-06-26-1430.md"), "a", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-1500.md"), "b", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-1600.md"), "c", "utf8");

    expect(await listHandoffs(logsDir, { limit: 2 })).toEqual([
      path.join(logsDir, "2026-06-26-1600.md"),
      path.join(logsDir, "2026-06-26-1500.md"),
    ]);
  });

  it("returns empty array when limit is zero or negative", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(path.join(logsDir, "2026-06-26-1430.md"), "a", "utf8");

    expect(await listHandoffs(logsDir, { limit: 0 })).toEqual([]);
    expect(await listHandoffs(logsDir, { limit: -1 })).toEqual([]);
  });

  it("includes markdown files in subfolders, sorted by basename", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");
    const nestedDir = path.join(logsDir, "feature");
    await mkdir(nestedDir, { recursive: true });
    const nested = path.join(nestedDir, "2026-06-26-160000-nested.md");
    const root = path.join(logsDir, "2026-06-26-150000-root.md");
    await writeFile(nested, "nested", "utf8");
    await writeFile(root, "root", "utf8");

    expect(await listHandoffs(logsDir)).toEqual([nested, root]);
  });
});
