import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listHandoffs } from "../../src/vault/list-handoffs.js";
import { createTempEnv } from "../helpers.js";

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
    await writeFile(path.join(logsDir, "2026-06-26-1430.md"), "a", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-1500-later.md"), "b", "utf8");
    await writeFile(path.join(logsDir, "2026-06-25-0900-old.md"), "c", "utf8");
    await writeFile(path.join(logsDir, "readme.txt"), "skip", "utf8");

    expect(await listHandoffs(logsDir)).toEqual([
      path.join(logsDir, "2026-06-26-1500-later.md"),
      path.join(logsDir, "2026-06-26-1430.md"),
      path.join(logsDir, "2026-06-25-0900-old.md"),
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
});
