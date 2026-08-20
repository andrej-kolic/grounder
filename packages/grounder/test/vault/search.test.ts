import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { searchVault } from "../../src/vault/search.js";

async function writeMd(rootDir: string, rel: string, body: string): Promise<string> {
  const filePath = path.join(rootDir, rel);
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(path.dirname(filePath), { recursive: true }),
  );
  await writeFile(filePath, body, "utf8");
  return filePath;
}

describe("vault/search", () => {
  it("matches whole words only — version does not match versioning", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      await writeMd(rootDir, "a.md", "schema versioning design\n");
      await writeMd(rootDir, "b.md", "npm version bump\n");

      const outcome = await searchVault({
        rootDir,
        query: "version",
        limit: 10,
      });

      expect(outcome.files).toHaveLength(1);
      expect(outcome.files[0]?.filePath).toContain("b.md");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("drops shorter stem terms when a longer form is present but keeps the query", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      await writeMd(rootDir, "a.md", "schema versioning design\n");
      await writeMd(rootDir, "b.md", "npm version bump\n");

      const outcome = await searchVault({
        rootDir,
        query: "version",
        terms: ["versioning"],
        limit: 10,
      });

      expect(outcome.terms).toEqual(["version", "versioning"]);
      expect(outcome.files).toHaveLength(2);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("caps file results at limit and sets truncated", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      for (let i = 0; i < 8; i++) {
        await writeMd(rootDir, `file-${i}.md`, `match term-${i}\n`);
      }

      const outcome = await searchVault({
        rootDir,
        query: "match",
        limit: 3,
      });

      expect(outcome.totalFileCount).toBe(8);
      expect(outcome.files).toHaveLength(3);
      expect(outcome.truncated).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("ranks files with more distinct term matches above sparse newer hits", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      const sparsePath = await writeMd(rootDir, "plans/recent-brief.md", "mentions migrate once\n");
      const densePath = await writeMd(
        rootDir,
        "plans/archive/schema_versioning.plan.md",
        [
          "slash command template refresh",
          "grounder migrate for upgrades",
          "hash drift detection",
          "schema versioning ledger",
          "command files under ~/.cursor/commands",
        ].join("\n"),
      );

      const sparseMtime = Date.now();
      const denseMtime = sparseMtime - 5000;
      await utimes(sparsePath, sparseMtime / 1000, sparseMtime / 1000);
      await utimes(densePath, denseMtime / 1000, denseMtime / 1000);

      const outcome = await searchVault({
        rootDir,
        query: "slash command migration",
        terms: ["migrate", "hash drift", "schema versioning", "command template"],
        limit: 5,
      });

      expect(outcome.files[0]?.filePath).toBe(densePath);
      expect(outcome.files[1]?.filePath).toBe(sparsePath);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("IDF: rare-term file outranks common-term file at equal distinctTermCount", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      // Seed 8 files containing "grounder" → high df → heavy IDF discount.
      for (let i = 0; i < 8; i++) {
        await writeMd(rootDir, `notes/note-${i}.md`, "grounder setup grounder grounder\n");
      }
      // commonPath: 4 hits of the ubiquitous term "grounder" (df≈9).
      const commonPath = await writeMd(
        rootDir,
        "plans/common.md",
        "grounder grounder grounder grounder\n",
      );
      // rarePath: 3 hits of a rare identifier "hooksSchema" (df=1).
      const rarePath = await writeMd(
        rootDir,
        "plans/rare.md",
        "hooksSchema hooksSchema hooksSchema\n",
      );

      const outcome = await searchVault({
        rootDir,
        query: "grounder",
        terms: ["hooksSchema"],
        limit: 5,
      });

      const filePaths = outcome.files.map((f) => f.filePath);
      // rarePath matches only one term; commonPath matches only one term.
      // IDF discounts the ubiquitous "grounder" more heavily than the rare
      // "hooksSchema", so rarePath should rank above commonPath.
      expect(filePaths.indexOf(rarePath)).toBeLessThan(filePaths.indexOf(commonPath));
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("ranks non-archive files above archive when relevance is equal", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      const archivePath = await writeMd(rootDir, "plans/archive/old.md", "versioning notes\n");
      const activePath = await writeMd(rootDir, "plans/active.md", "versioning notes\n");

      const archiveMtime = Date.now();
      const activeMtime = archiveMtime - 1000;
      await utimes(archivePath, archiveMtime / 1000, archiveMtime / 1000);
      await utimes(activePath, activeMtime / 1000, activeMtime / 1000);

      const outcome = await searchVault({
        rootDir,
        query: "versioning",
        limit: 5,
      });

      expect(outcome.files[0]?.filePath).toBe(activePath);
      expect(outcome.files[1]?.filePath).toBe(archivePath);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
