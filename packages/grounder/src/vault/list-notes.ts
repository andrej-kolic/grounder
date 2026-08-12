import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface ListNotesOptions {
  /** Max paths to return (newest first). Omit to return all. */
  limit?: number;
}

/**
 * Lists note markdown files under `notesDir`, newest mtime first.
 * Returns absolute paths. Missing or empty dirs yield `[]`.
 * Ties break by filename descending for stable output.
 *
 * Filename-descending alone is a viable alternative for notes (timestamp
 * prefixes, like `listHandoffs`), but this intentionally matches `listPlans`
 * for consistency across list commands.
 */
export async function listNotes(
  notesDir: string,
  options: ListNotesOptions = {},
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(notesDir);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const mdNames = entries.filter((name) => name.endsWith(".md"));
  const withMtime = await Promise.all(
    mdNames.map(async (name) => {
      const filePath = path.join(notesDir, name);
      const { mtimeMs } = await stat(filePath);
      return { filePath, name, mtimeMs };
    }),
  );

  withMtime.sort((a, b) => {
    if (a.mtimeMs !== b.mtimeMs) {
      return b.mtimeMs - a.mtimeMs;
    }
    return a.name < b.name ? 1 : a.name > b.name ? -1 : 0;
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
