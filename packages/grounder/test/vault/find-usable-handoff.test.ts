import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findUsableHandoff } from "../../src/vault/find-usable-handoff.js";
import { createTempEnv } from "../helpers.js";

describe("vault/find-usable-handoff", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("returns undefined when the dir is missing or empty", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "missing-logs");

    expect(await findUsableHandoff(logsDir)).toBeUndefined();
  });

  it("returns the newest file when it has content", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(path.join(logsDir, "2026-06-26-1400.md"), "older", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-1500-newer.md"), "newer content", "utf8");

    const result = await findUsableHandoff(logsDir);

    expect(result?.path).toBe(path.join(logsDir, "2026-06-26-1500-newer.md"));
    expect(result?.content).toBe("newer content");
  });

  it("falls back to the next-newest file when the newest is empty", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(path.join(logsDir, "2026-06-26-1400-older.md"), "older content", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-1500-empty.md"), "", "utf8");

    const result = await findUsableHandoff(logsDir);

    expect(result?.path).toBe(path.join(logsDir, "2026-06-26-1400-older.md"));
  });

  it("falls back past a whitespace-only file", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(path.join(logsDir, "2026-06-26-1400-older.md"), "older content", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-1500-blank.md"), "   \n\n", "utf8");

    const result = await findUsableHandoff(logsDir);

    expect(result?.path).toBe(path.join(logsDir, "2026-06-26-1400-older.md"));
  });

  it("returns undefined when every candidate within the scan window is empty", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(path.join(logsDir, "2026-06-26-1400.md"), "", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-1500.md"), "", "utf8");

    expect(await findUsableHandoff(logsDir)).toBeUndefined();
  });

  it("respects a custom scan limit", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(path.join(logsDir, "2026-06-26-1300-usable.md"), "content", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-1400-empty.md"), "", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-1500-empty.md"), "", "utf8");

    expect(await findUsableHandoff(logsDir, { limit: 2 })).toBeUndefined();
    expect((await findUsableHandoff(logsDir, { limit: 3 }))?.path).toBe(
      path.join(logsDir, "2026-06-26-1300-usable.md"),
    );
  });
});
