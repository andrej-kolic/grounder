import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listPlans, listPlansDetailed } from "../../src/vault/list-plans.js";
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

  it("listPlansDetailed returns the same ranking with each entry's real mtime attached", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");
    await mkdir(plansDir, { recursive: true });

    const older = path.join(plansDir, "older.md");
    const newer = path.join(plansDir, "newer.md");
    await writeFile(older, "a", "utf8");
    await writeFile(newer, "b", "utf8");
    const olderMtime = new Date("2026-06-25T09:00:00.000Z");
    const newerMtime = new Date("2026-06-26T15:00:00.000Z");
    await touch(older, olderMtime);
    await touch(newer, newerMtime);

    expect(await listPlansDetailed(plansDir)).toEqual([
      { path: newer, mtimeMs: newerMtime.getTime() },
      { path: older, mtimeMs: olderMtime.getTime() },
    ]);
  });

  it("breaks mtime ties by vault-relative path descending", async () => {
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

  it("ranks by frontmatter updated over mtime, so a git checkout can't reorder plans", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");
    await mkdir(plansDir, { recursive: true });

    const olderContent = path.join(plansDir, "older-content.md");
    const newerContent = path.join(plansDir, "newer-content.md");
    await writeFile(
      olderContent,
      '---\nproject: "p"\ncreated: "2026-06-01T00:00:00.000Z"\nupdated: "2026-06-01T00:00:00.000Z"\n---\n\nbody',
      "utf8",
    );
    await writeFile(
      newerContent,
      '---\nproject: "p"\ncreated: "2026-06-01T00:00:00.000Z"\nupdated: "2026-06-26T15:00:00.000Z"\n---\n\nbody',
      "utf8",
    );
    // Checkout mtime is the opposite of frontmatter recency — ranking must ignore it.
    await touch(olderContent, new Date("2026-06-27T00:00:00.000Z"));
    await touch(newerContent, new Date("2026-06-20T00:00:00.000Z"));

    expect(await listPlans(plansDir)).toEqual([newerContent, olderContent]);
  });

  it("ranks by frontmatter created when updated is absent", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");
    await mkdir(plansDir, { recursive: true });

    const older = path.join(plansDir, "older.md");
    const newer = path.join(plansDir, "newer.md");
    await writeFile(
      older,
      '---\nproject: "p"\ncreated: "2026-06-01T00:00:00.000Z"\n---\n\nbody',
      "utf8",
    );
    await writeFile(
      newer,
      '---\nproject: "p"\ncreated: "2026-06-26T15:00:00.000Z"\n---\n\nbody',
      "utf8",
    );
    // Same trick: checkout mtime is reversed from `created`.
    await touch(older, new Date("2026-06-27T00:00:00.000Z"));
    await touch(newer, new Date("2026-06-20T00:00:00.000Z"));

    expect(await listPlans(plansDir)).toEqual([newer, older]);
  });

  it("falls back to mtime for plans with no parseable frontmatter timestamp", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");
    await mkdir(plansDir, { recursive: true });

    const noFrontmatter = path.join(plansDir, "no-frontmatter.md");
    const withFrontmatter = path.join(plansDir, "with-frontmatter.md");
    await writeFile(noFrontmatter, "plain body, no frontmatter", "utf8");
    await writeFile(
      withFrontmatter,
      '---\nproject: "p"\ncreated: "2026-06-01T00:00:00.000Z"\n---\n\nbody',
      "utf8",
    );
    await touch(noFrontmatter, new Date("2026-06-27T00:00:00.000Z"));
    await touch(withFrontmatter, new Date("2026-06-20T00:00:00.000Z"));

    expect(await listPlans(plansDir)).toEqual([noFrontmatter, withFrontmatter]);
  });

  it("includes markdown files in subfolders", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");
    const nestedDir = path.join(plansDir, "migration");
    await mkdir(nestedDir, { recursive: true });

    const rootPlan = path.join(plansDir, "overview.md");
    const nestedPlan = path.join(nestedDir, "cutover.md");
    await writeFile(rootPlan, "root", "utf8");
    await writeFile(nestedPlan, "nested", "utf8");
    await touch(rootPlan, new Date("2026-06-26T13:00:00.000Z"));
    await touch(nestedPlan, new Date("2026-06-26T15:00:00.000Z"));

    expect(await listPlans(plansDir)).toEqual([nestedPlan, rootPlan]);
  });
});
