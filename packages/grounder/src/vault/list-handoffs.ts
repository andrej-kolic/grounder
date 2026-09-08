import { stat } from "node:fs/promises";
import path from "node:path";
import { vaultRelativePath } from "../util/path.js";
import { listMarkdownFiles } from "./list-markdown.js";

export interface ListHandoffsOptions {
  /** Max paths to return (newest first). Omit to return all. */
  limit?: number;
}

/** One handoff with its mtime (see {@link listHandoffsDetailed}). */
export interface HandoffEntry {
  path: string;
  mtimeMs: number;
}

function rankHandoffPaths(mdPaths: readonly string[], logsDir: string): string[] {
  const ranked = mdPaths.map((filePath) => ({
    filePath,
    name: path.basename(filePath),
    rel: vaultRelativePath(logsDir, filePath),
  }));

  ranked.sort((a, b) => {
    if (a.name !== b.name) {
      return a.name < b.name ? 1 : -1;
    }
    return a.rel < b.rel ? 1 : a.rel > b.rel ? -1 : 0;
  });

  return ranked.map((entry) => entry.filePath);
}

function applyLimit(paths: readonly string[], limit: number | undefined): string[] {
  if (limit === undefined) {
    return [...paths];
  }
  if (limit <= 0) {
    return [];
  }
  return paths.slice(0, limit);
}

/**
 * Lists handoff markdown files under `logsDir` recursively, newest basename
 * first (timestamp-prefixed names sort correctly), with each entry's mtime
 * attached. Same basename in different subfolders ties break by
 * vault-relative path descending. Missing or empty dirs yield `[]`.
 *
 * Ranking never reads mtime (filenames already sort correctly), so this
 * stats only the paths a `limit` actually keeps, not the whole bucket.
 */
export async function listHandoffsDetailed(
  logsDir: string,
  options: ListHandoffsOptions = {},
): Promise<HandoffEntry[]> {
  const mdPaths = await listMarkdownFiles(logsDir);
  const paths = applyLimit(rankHandoffPaths(mdPaths, logsDir), options.limit);
  return Promise.all(
    paths.map(async (filePath) => ({ path: filePath, mtimeMs: (await stat(filePath)).mtimeMs })),
  );
}

/** Same ranking as {@link listHandoffsDetailed}, paths only (no stat calls). */
export async function listHandoffs(
  logsDir: string,
  options: ListHandoffsOptions = {},
): Promise<string[]> {
  const mdPaths = await listMarkdownFiles(logsDir);
  return applyLimit(rankHandoffPaths(mdPaths, logsDir), options.limit);
}
