import { stat } from "node:fs/promises";
import { vaultRelativePath } from "../util/path.js";
import { listMarkdownFiles } from "./list-markdown.js";

export interface ListPlansOptions {
  /** Max paths to return (newest first). Omit to return all. */
  limit?: number;
}

/**
 * Lists plan markdown files under `plansDir` recursively, newest mtime first.
 * Returns absolute paths. Missing or empty dirs yield `[]`.
 * Ties break by vault-relative path descending for stable output.
 */
export async function listPlans(
  plansDir: string,
  options: ListPlansOptions = {},
): Promise<string[]> {
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

  const paths = withMtime.map((entry) => entry.filePath);

  if (options.limit === undefined) {
    return paths;
  }
  if (options.limit <= 0) {
    return [];
  }
  return paths.slice(0, options.limit);
}
