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

  it("counts every matching term on a line toward distinct-term score and termHitCounts", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      const packedPath = await writeMd(
        rootDir,
        "plans/packed.md",
        ["slash commands via grounder migrate", "hash drift in commandsSchema and state.json"].join(
          "\n",
        ),
      );
      const sparsePath = await writeMd(rootDir, "plans/sparse.md", "slash commands only\n");

      const now = Date.now();
      await utimes(sparsePath, now / 1000, now / 1000);
      await utimes(packedPath, (now - 5000) / 1000, (now - 5000) / 1000);

      const outcome = await searchVault({
        rootDir,
        query: "handling migrations",
        terms: ["slash commands", "grounder migrate", "hash drift", "commandsSchema", "state.json"],
        limit: 5,
      });

      expect(outcome.files[0]?.filePath).toBe(packedPath);
      expect(outcome.files[1]?.filePath).toBe(sparsePath);
      expect(outcome.termHitCounts["slash commands"]).toBe(2);
      expect(outcome.termHitCounts["grounder migrate"]).toBe(1);
      expect(outcome.termHitCounts["hash drift"]).toBe(1);
      expect(outcome.termHitCounts.commandsSchema).toBe(1);
      expect(outcome.termHitCounts["state.json"]).toBe(1);
      expect(outcome.files[0]?.hits[0]?.matchedTerm).toBe("grounder migrate");
      expect(outcome.files[0]?.matchedTerms).toEqual([
        "grounder migrate",
        "slash commands",
        "commandsSchema",
        "hash drift",
        "state.json",
      ]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("matches a query that only appears in the filename stem, not the body", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      const p1Path = await writeMd(rootDir, "plans/p1.md", "o1\n");

      const outcome = await searchVault({
        rootDir,
        query: "p1",
        limit: 10,
      });

      expect(outcome.files).toHaveLength(1);
      expect(outcome.files[0]?.filePath).toBe(p1Path);
      expect(outcome.files[0]?.hits).toHaveLength(0);
      expect(outcome.files[0]?.matchedTerms).toEqual(["p1"]);
      expect(outcome.totalFileCount).toBe(1);
      // Every zero-hit check downstream (summary text, JSON, the extension's
      // QuickPick) keys off totalMatchCount, not file count — a title-only
      // hit must count as exactly one match, not be reported as "no matches".
      expect(outcome.totalMatchCount).toBe(1);
      // termHitCounts feeds the skill's "bad term, replace it" broaden check
      // (docs/architecture/vault-search.md) — a stem-only term must not read
      // as zero-hit there even though it never appears in any file's body.
      expect(outcome.termHitCounts.p1).toBe(1);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("does not match a query that is only a parent folder name", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      // Neither file mentions "plans" in its body or its own stem — only the
      // shared `plans/` directory name does. A folder-name query must not
      // flood every file in that folder regardless of content.
      await writeMd(rootDir, "plans/unrelated-one.md", "nothing relevant here\n");
      await writeMd(rootDir, "plans/unrelated-two.md", "nothing relevant here either\n");

      const outcome = await searchVault({
        rootDir,
        query: "plans",
        limit: 10,
      });

      expect(outcome.files).toHaveLength(0);
      expect(outcome.totalFileCount).toBe(0);
      expect(outcome.totalMatchCount).toBe(0);
      // The whole point of the stem/path split: a folder-name-only term must
      // not read as a real hit for the skill's zero-hit "bad term" broaden
      // check either — only stem matches feed termHitCounts, path matches
      // (which is all "plans" is here) must not.
      expect(outcome.termHitCounts.plans).toBe(0);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("does not match a query against a dotted pseudo-extension in the stem", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      // Real vault convention (`plans/archive/.../<id>.plan.md`): the `.plan`
      // segment is a type tag, not a standalone word — a query "plan" must
      // not match this file's stem when the body never says "plan" either.
      await writeMd(rootDir, "schema_versioning.plan.md", "unrelated body text\n");

      const outcome = await searchVault({
        rootDir,
        query: "plan",
        limit: 10,
      });

      expect(outcome.files).toHaveLength(0);
      expect(outcome.totalFileCount).toBe(0);
      expect(outcome.totalMatchCount).toBe(0);
      expect(outcome.termHitCounts.plan).toBe(0);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("does not match a query against an underscore-joined word in the stem", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      // Unlike a hyphen, `_` is a `\w` character — it fuses a stem into one
      // token, same as `\b`'s pre-existing behavior for body content (see
      // the "version does not match versioning" test above). A query for
      // just one half of an underscore-joined stem must not match it.
      await writeMd(rootDir, "search_feature.md", "unrelated body text\n");

      const outcome = await searchVault({
        rootDir,
        query: "search",
        limit: 10,
      });

      expect(outcome.files).toHaveLength(0);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("still matches a query against the id preceding a dotted pseudo-extension", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      // Same file as above, but the query is the actual identifier the
      // dotted suffix follows — this is the whole point of stem inclusion
      // (the `pluggable.md` motivating case), so it must still match even
      // though "plan" (the suffix) correctly does not.
      const idPath = await writeMd(rootDir, "schema_versioning.plan.md", "unrelated body text\n");

      const outcome = await searchVault({
        rootDir,
        query: "schema_versioning",
        limit: 10,
      });

      expect(outcome.files).toHaveLength(1);
      expect(outcome.files[0]?.filePath).toBe(idPath);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("still matches a query against a hyphen-separated word in the stem", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      // Hyphens (unlike the dotted pseudo-extension above) are a genuine
      // word separator in this vault's kebab-case filenames — must keep
      // matching, e.g. "search" finding `search-feature.md`.
      const searchFeaturePath = await writeMd(
        rootDir,
        "search-feature.md",
        "unrelated body text\n",
      );

      const outcome = await searchVault({
        rootDir,
        query: "search",
        limit: 10,
      });

      expect(outcome.files).toHaveLength(1);
      expect(outcome.files[0]?.filePath).toBe(searchFeaturePath);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("ranks a file that actually discusses the topic above a title-only match", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      // Named after the concept but never repeats the word in body — the
      // motivating case (e.g. `pluggable.md`). Should still appear, but not
      // outrank a file that substantively discusses the same topic.
      const titleOnlyPath = await writeMd(
        rootDir,
        "discussions/pluggable.md",
        "unrelated body text\n",
      );
      const contentPath = await writeMd(
        rootDir,
        "discussions/architecture.md",
        "pluggable adapters let agents plug in without touching core pluggable internals\n",
      );

      const outcome = await searchVault({
        rootDir,
        query: "pluggable",
        limit: 10,
      });

      expect(outcome.files.map((f) => f.filePath)).toEqual([contentPath, titleOnlyPath]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("still gives a content-matched file a path-segment rank bonus", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      // Both files have exactly one content match on "migrate" (same
      // distinct-term score); the one under `plans/` should still rank
      // first via the pre-existing `filenameTermCount` bonus for a plain
      // path segment matching a passed `--terms` item — this specific case
      // (a folder name, no dot involved) is unaffected by the stem/path
      // split. See the dotted-stem test below for a case that *did* change.
      const inPlansPath = await writeMd(rootDir, "plans/foo.md", "we should migrate this\n");
      const elsewherePath = await writeMd(rootDir, "other/bar.md", "we should migrate that\n");

      const outcome = await searchVault({
        rootDir,
        query: "migrate",
        terms: ["plans"],
        limit: 10,
      });

      expect(outcome.files.map((f) => f.filePath)).toEqual([inPlansPath, elsewherePath]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("no longer gives a dotted pseudo-extension a path-segment rank bonus", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      // Before the dot-boundary fix, plain `\bterm\b` treated "." as an
      // ordinary boundary, so a content-matching `<id>.plan.md` file also
      // got `filenameTermCount`'s rank bonus for the path segment "plan" —
      // that stopped once `pathMatchedTerms` started sharing the same
      // dot-aware matcher as the stem-inclusion gate. Both files have one
      // identical content match on "plan"; make the dotted one older so a
      // leftover path bonus (score tie broken by recency) would still let
      // it win despite being older — it must not.
      const dottedPath = await writeMd(
        rootDir,
        "schema_versioning.plan.md",
        "we should make a plan for this migration\n",
      );
      const plainPath = await writeMd(
        rootDir,
        "foo.md",
        "we should make a plan for this migration too\n",
      );
      const now = Date.now();
      await utimes(dottedPath, (now - 10000) / 1000, (now - 10000) / 1000);
      await utimes(plainPath, now / 1000, now / 1000);

      const outcome = await searchVault({
        rootDir,
        query: "plan",
        limit: 10,
      });

      expect(outcome.files.map((f) => f.filePath)).toEqual([plainPath, dottedPath]);
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

  it("long-query partial phrase needs a 3-word slice, not a loose bigram only", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      const hooksPath = await writeMd(
        rootDir,
        "plans/archive/0.2.0 and older/cursor-hooks-fixes.md",
        [
          "Cursor hooks migrated from npx to runtime",
          "slash commands still use npx at this stage",
          "vault init --hooks replaces legacy entries",
        ].join("\n"),
      );
      const schemaPath = await writeMd(
        rootDir,
        "plans/archive/0.3.0/schema_versioning_for_grounder_ac9204ad.plan.md",
        [
          "handling migrations of slash commands via grounder migrate",
          "commandsSchema and state.json ledger with hash drift detection",
          "chezmoi-style drift for user-editable slash command markdown",
        ].join("\n"),
      );

      const outcome = await searchVault({
        rootDir,
        query: "handling migrations of slash comands",
        terms: ["slash commands", "grounder migrate", "commandsSchema", "state.json", "hash drift"],
        limit: 5,
      });

      expect(outcome.files[0]?.filePath).toBe(schemaPath);
      const hooksRank = outcome.files.findIndex((file) => file.filePath === hooksPath);
      expect(hooksRank).toBeGreaterThan(0);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("exact long phrase (3+ words, no --terms) finds the file containing it verbatim", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      const phrase = "launch five subagents in parallel";
      const planPath = await writeMd(
        rootDir,
        "plans/live-eval-harness.md",
        ["# Live eval harness", "", `tells the orchestrator agent to ${phrase}`].join("\n"),
      );
      await writeMd(rootDir, "plans/other.md", "unrelated content\n");

      const outcome = await searchVault({
        rootDir,
        query: phrase,
        limit: 10,
      });

      expect(outcome.terms).toEqual([phrase]);
      expect(outcome.termHitCounts[phrase]).toBe(1);
      expect(outcome.files).toHaveLength(1);
      expect(outcome.files[0]?.filePath).toBe(planPath);
      expect(outcome.files[0]?.matchedTerms).toContain(phrase);
      expect(outcome.files[0]?.hits.some((hit) => hit.matchedTerm === phrase)).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("topics: match outranks a denser file that only hits in the body", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      const densePath = await writeMd(
        rootDir,
        "notes/dense.md",
        Array.from({ length: 12 }, () => "versioning").join("\n"),
      );
      const topicsPath = await writeMd(
        rootDir,
        "notes/tagged.md",
        ["---", 'topics: ["versioning"]', "---", "", "one versioning mention"].join("\n"),
      );

      const now = Date.now();
      await utimes(densePath, now / 1000, now / 1000);
      await utimes(topicsPath, (now - 5000) / 1000, (now - 5000) / 1000);

      const outcome = await searchVault({
        rootDir,
        query: "versioning",
        limit: 5,
      });

      expect(outcome.files[0]?.filePath).toBe(topicsPath);
      expect(outcome.files[0]?.topicsMatch).toBe(true);
      expect(outcome.files[1]?.filePath).toBe(densePath);
      expect(outcome.files[1]?.topicsMatch).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("demotes discussions/search dumps when the query is not about search", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      const realPath = await writeMd(rootDir, "plans/schema.md", "migrate ledger\n");
      const dumpPath = await writeMd(
        rootDir,
        "discussions/search/dump.md",
        Array.from({ length: 20 }, () => "migrate ledger").join("\n"),
      );

      const now = Date.now();
      await utimes(dumpPath, now / 1000, now / 1000);
      await utimes(realPath, (now - 5000) / 1000, (now - 5000) / 1000);

      const demoted = await searchVault({
        rootDir,
        query: "migrate",
        terms: ["ledger"],
        limit: 5,
      });
      expect(demoted.files[0]?.filePath).toBe(realPath);
      expect(demoted.files[1]?.filePath).toBe(dumpPath);

      const aboutSearch = await searchVault({
        rootDir,
        query: "search",
        terms: ["migrate"],
        limit: 5,
      });
      expect(aboutSearch.files[0]?.filePath).toBe(dumpPath);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("demotes search-feature.md when the query is not about search", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "grounder-search-"));
    try {
      const realPath = await writeMd(rootDir, "plans/schema.md", "migrate ledger\n");
      const metaPath = await writeMd(
        rootDir,
        "plans/search-feature.md",
        Array.from({ length: 20 }, () => "migrate ledger").join("\n"),
      );

      const now = Date.now();
      await utimes(metaPath, now / 1000, now / 1000);
      await utimes(realPath, (now - 5000) / 1000, (now - 5000) / 1000);

      const outcome = await searchVault({
        rootDir,
        query: "migrate",
        terms: ["ledger"],
        limit: 5,
      });

      expect(outcome.files[0]?.filePath).toBe(realPath);
      expect(outcome.files[1]?.filePath).toBe(metaPath);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
