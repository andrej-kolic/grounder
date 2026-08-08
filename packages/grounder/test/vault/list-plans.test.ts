import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listPlans } from "../../src/vault/list-plans.js";
import { createTempEnv } from "../helpers.js";

async function touch(filePath: string, when: Date): Promise<void> {
  await utimes(filePath, when, when);
}

describe("vault/list-plans", () => {
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
    const plansDir = path.join(env.vault, "missing-plans");

    expect(await listPlans(plansDir)).toEqual([]);
  });

  it("returns empty array when dir is empty", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");
    await mkdir(plansDir, { recursive: true });

    expect(await listPlans(plansDir)).toEqual([]);
  });

  it("sorts markdown files newest-first by mtime", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");
    await mkdir(plansDir, { recursive: true });

    const older = path.join(plansDir, "older.md");
    const newer = path.join(plansDir, "document 1.md");
    const mid = path.join(plansDir, "phase-1.md");
    await writeFile(older, "a", "utf8");
    await writeFile(newer, "b", "utf8");
    await writeFile(mid, "c", "utf8");
    await writeFile(path.join(plansDir, "readme.txt"), "skip", "utf8");

    await touch(older, new Date("2026-06-25T09:00:00.000Z"));
    await touch(mid, new Date("2026-06-26T14:00:00.000Z"));
    await touch(newer, new Date("2026-06-26T15:00:00.000Z"));

    expect(await listPlans(plansDir)).toEqual([newer, mid, older]);
  });

  it("breaks mtime ties by filename descending", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");
    await mkdir(plansDir, { recursive: true });

    const a = path.join(plansDir, "alpha.md");
    const z = path.join(plansDir, "zeta.md");
    await writeFile(a, "a", "utf8");
    await writeFile(z, "z", "utf8");
    const same = new Date("2026-06-26T14:00:00.000Z");
    await touch(a, same);
    await touch(z, same);

    expect(await listPlans(plansDir)).toEqual([z, a]);
  });

  it("applies limit (newest first)", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");
    await mkdir(plansDir, { recursive: true });

    const a = path.join(plansDir, "a.md");
    const b = path.join(plansDir, "b.md");
    const c = path.join(plansDir, "c.md");
    await writeFile(a, "a", "utf8");
    await writeFile(b, "b", "utf8");
    await writeFile(c, "c", "utf8");
    await touch(a, new Date("2026-06-26T13:00:00.000Z"));
    await touch(b, new Date("2026-06-26T14:00:00.000Z"));
    await touch(c, new Date("2026-06-26T15:00:00.000Z"));

    expect(await listPlans(plansDir, { limit: 2 })).toEqual([c, b]);
  });

  it("returns empty array when limit is zero or negative", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");
    await mkdir(plansDir, { recursive: true });
    await writeFile(path.join(plansDir, "a.md"), "a", "utf8");

    expect(await listPlans(plansDir, { limit: 0 })).toEqual([]);
    expect(await listPlans(plansDir, { limit: -1 })).toEqual([]);
  });
});
