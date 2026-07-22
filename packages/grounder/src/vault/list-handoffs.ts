import { readdir } from "node:fs/promises";
import path from "node:path";

export interface ListHandoffsOptions {
  /** Max paths to return (newest first). Omit to return all. */
  limit?: number;
}

/**
 * Lists handoff markdown files under `logsDir`, newest filename first.
 * Returns absolute paths. Missing or empty dirs yield `[]`.
 */
export async function listHandoffs(
  logsDir: string,
  options: ListHandoffsOptions = {},
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(logsDir);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const paths = entries
    .filter((name) => name.endsWith(".md"))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((name) => path.join(logsDir, name));

  if (options.limit === undefined) {
    return paths;
  }
  if (options.limit <= 0) {
    return [];
  }
  return paths.slice(0, options.limit);
}
