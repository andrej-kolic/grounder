import { mkdir } from "node:fs/promises";
import { writeUniqueMarkdown } from "../util/fs.js";
import { timestampedBasename } from "../util/timestamp-slug.js";

export interface WriteNoteOptions {
  title?: string;
  now?: Date;
}

/**
 * Writes a new note markdown file under `notesDir` (created if missing).
 * Never overwrites — exclusive create with `_NN` on collision.
 * @returns Absolute path of the written file.
 */
export async function writeNote(
  notesDir: string,
  text: string,
  options: WriteNoteOptions = {},
): Promise<string> {
  const now = options.now ?? new Date();
  await mkdir(notesDir, { recursive: true });

  const basename = timestampedBasename(text, { title: options.title, now });
  return writeUniqueMarkdown(notesDir, basename, text);
}
