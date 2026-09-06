import { stat } from "node:fs/promises";
import { vaultRelativePath } from "../util/path.js";
import { listMarkdownFiles } from "./list-markdown.js";

export interface ListPlansOptions {
  /** Max paths to return (newest first). Omit to return all. */
  limit?: number;
}

/** One plan with the mtime already used to rank it (see {@link listPlansDetailed}). */
export interface PlanEntry {
  path: string;
  mtimeMs: number;
}

/**
 * Lists plan markdown files under `plansDir` recursively, newest mtime first,
 * with each entry's mtime attached — the same stat this module already does
 * internally to rank plans, just not thrown away after sorting. Missing or
 * empty dirs yield `[]`. Ties break by vault-relative path descending for
 * stable output.
 */
export async function listPlansDetailed(
  plansDir: string,
  options: ListPlansOptions = {},
): Promise<PlanEntry[]> {
  const mdPaths = await listMarkdownFiles(plansDir);
  const withMtime = await Promise.all(
    mdPaths.map(async (filePath) => {
      const { mtimeMs } = await stat(filePath);
      return { filePath, rel: vaultRelativePath(plansDir, filePath), mtimeMs };
    }),
  );

  withMtime.sort((a, b) => {
    if (a.mtimeMs !== b.mtimeMs) {
      return b.mtimeMs - a.mtimeMs;
    }
    return a.rel < b.rel ? 1 : a.rel > b.rel ? -1 : 0;
  });

  const entries = withMtime.map((entry) => ({ path: entry.filePath, mtimeMs: entry.mtimeMs }));

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
