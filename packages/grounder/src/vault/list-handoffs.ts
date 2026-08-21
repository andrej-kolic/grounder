import path from "node:path";
import { vaultRelativePath } from "../util/path.js";
import { listMarkdownFiles } from "./list-markdown.js";

export interface ListHandoffsOptions {
  /** Max paths to return (newest first). Omit to return all. */
  limit?: number;
}

/**
 * Lists handoff markdown files under `logsDir` recursively, newest basename
 * first (timestamp-prefixed names sort correctly). Same basename in different
 * subfolders ties break by vault-relative path descending.
 * Returns absolute paths. Missing or empty dirs yield `[]`.
 */
export async function listHandoffs(
  logsDir: string,
  options: ListHandoffsOptions = {},
): Promise<string[]> {
  const mdPaths = await listMarkdownFiles(logsDir);
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

  const paths = ranked.map((entry) => entry.filePath);

  if (options.limit === undefined) {
    return paths;
  }
  if (options.limit <= 0) {
    return [];
  }
  return paths.slice(0, options.limit);
}
