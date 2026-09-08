import { stat } from "node:fs/promises";
import { vaultRelativePath } from "../util/path.js";
import { listMarkdownFiles } from "./list-markdown.js";

export interface ListNotesOptions {
  /** Max paths to return (newest first). Omit to return all. */
  limit?: number;
}

/** One note with the mtime already used to rank it (see {@link listNotesDetailed}). */
export interface NoteEntry {
  path: string;
  mtimeMs: number;
}

/**
 * Lists note markdown files under `notesDir` recursively, newest mtime first,
 * with each entry's mtime attached — the same stat this module already does
 * internally to rank notes, just not thrown away after sorting. Missing or
 * empty dirs yield `[]`. Ties break by vault-relative path descending for
 * stable output.
 *
 * Matches {@link listPlans} sorting for consistency across list commands
 * (filename-descending alone is viable for timestamp-prefixed notes, like
 * {@link listHandoffs}).
 */
export async function listNotesDetailed(
  notesDir: string,
  options: ListNotesOptions = {},
): Promise<NoteEntry[]> {
  const mdPaths = await listMarkdownFiles(notesDir);
  const withMtime = await Promise.all(
    mdPaths.map(async (filePath) => {
      const { mtimeMs } = await stat(filePath);
      return { filePath, rel: vaultRelativePath(notesDir, filePath), mtimeMs };
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

/** Same ranking as {@link listNotesDetailed}, paths only. */
export async function listNotes(
  notesDir: string,
  options: ListNotesOptions = {},
): Promise<string[]> {
  return (await listNotesDetailed(notesDir, options)).map((entry) => entry.path);
}
