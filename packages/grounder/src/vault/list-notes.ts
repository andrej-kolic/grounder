import { stat } from "node:fs/promises";
import path from "node:path";
import { vaultRelativePath } from "../util/path.js";
import { listMarkdownFiles } from "./list-markdown.js";

export interface ListNotesOptions {
  /** Max paths to return (newest first). Omit to return all. */
  limit?: number;
}

/** One note with its mtime (see {@link listNotesDetailed}). */
export interface NoteEntry {
  path: string;
  mtimeMs: number;
}

function rankNotePaths(mdPaths: readonly string[], notesDir: string): string[] {
  const ranked = mdPaths.map((filePath) => ({
    filePath,
    name: path.basename(filePath),
    rel: vaultRelativePath(notesDir, filePath),
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
 * Lists note markdown files under `notesDir` recursively, newest basename
 * first, with each entry's mtime attached. Notes are written with the same
 * UTC `YYYY-MM-DD-HHmmss` filename prefix as handoffs (see
 * {@link listHandoffs}), so filename-descending ranking is immune to git
 * checkout rewriting mtime — unlike a raw mtime sort, which this module used
 * to do. Same basename in different subfolders ties break by vault-relative
 * path descending. Missing or empty dirs yield `[]`.
 *
 * Ranking never reads mtime, so this stats only the paths a `limit` actually
 * keeps, not the whole bucket.
 */
export async function listNotesDetailed(
  notesDir: string,
  options: ListNotesOptions = {},
): Promise<NoteEntry[]> {
  const mdPaths = await listMarkdownFiles(notesDir);
  const paths = applyLimit(rankNotePaths(mdPaths, notesDir), options.limit);
  return Promise.all(
    paths.map(async (filePath) => ({ path: filePath, mtimeMs: (await stat(filePath)).mtimeMs })),
  );
}

/** Same ranking as {@link listNotesDetailed}, paths only (no stat calls). */
export async function listNotes(
  notesDir: string,
  options: ListNotesOptions = {},
): Promise<string[]> {
  const mdPaths = await listMarkdownFiles(notesDir);
  return applyLimit(rankNotePaths(mdPaths, notesDir), options.limit);
}
