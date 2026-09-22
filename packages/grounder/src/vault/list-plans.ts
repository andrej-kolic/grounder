import { readFile, stat } from "node:fs/promises";
import { parseHandoffFrontmatter } from "../util/frontmatter.js";
import { vaultRelativePath } from "../util/path.js";
import { listMarkdownFiles } from "./list-markdown.js";

export interface ListPlansOptions {
  /** Max paths to return (newest first). Omit to return all. */
  limit?: number;
}

/** One plan with the mtime already fetched while ranking it (see {@link listPlansDetailed}). */
export interface PlanEntry {
  path: string;
  mtimeMs: number;
}

/** Rank timestamp for a plan: frontmatter `updated`, else `created`, else its mtime. */
function rankMs(content: string, mtimeMs: number): number {
  const fm = parseHandoffFrontmatter(content);
  const parsed = Date.parse(fm.updated ?? fm.created ?? "");
  return Number.isNaN(parsed) ? mtimeMs : parsed;
}

/**
 * Lists plan markdown files under `plansDir` recursively, newest first, with
 * each entry's real mtime attached. Ranked by frontmatter `updated` (falling
 * back to `created`, then to mtime for files with no parseable frontmatter
 * timestamp) rather than raw mtime, since git checkout sets mtime to checkout
 * time and would otherwise scramble order on a fresh clone. Missing or empty
 * dirs yield `[]`. Ties break by vault-relative path descending for stable
 * output.
 */
export async function listPlansDetailed(
  plansDir: string,
  options: ListPlansOptions = {},
): Promise<PlanEntry[]> {
  const mdPaths = await listMarkdownFiles(plansDir);
  const withRank = await Promise.all(
    mdPaths.map(async (filePath) => {
      const [{ mtimeMs }, content] = await Promise.all([
        stat(filePath),
        readFile(filePath, "utf8"),
      ]);
      return {
        filePath,
        rel: vaultRelativePath(plansDir, filePath),
        mtimeMs,
        rank: rankMs(content, mtimeMs),
      };
    }),
  );

  withRank.sort((a, b) => {
    if (a.rank !== b.rank) {
      return b.rank - a.rank;
    }
    return a.rel < b.rel ? 1 : a.rel > b.rel ? -1 : 0;
  });

  const entries = withRank.map((entry) => ({ path: entry.filePath, mtimeMs: entry.mtimeMs }));

  if (options.limit === undefined) {
    return entries;
  }
  if (options.limit <= 0) {
    return [];
  }
  return entries.slice(0, options.limit);
}

/** Same ranking as {@link listPlansDetailed}, paths only. */
export async function listPlans(
  plansDir: string,
  options: ListPlansOptions = {},
): Promise<string[]> {
  return (await listPlansDetailed(plansDir, options)).map((entry) => entry.path);
}
