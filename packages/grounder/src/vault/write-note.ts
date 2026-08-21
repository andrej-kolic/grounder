import { mkdir } from "node:fs/promises";
import { writeUniqueMarkdown } from "../util/fs.js";
import { timestampedBasename } from "../util/timestamp-slug.js";
import { yamlDoubleQuoted } from "../util/yaml.js";

export interface WriteNoteOptions {
  title?: string;
  /** 3-5 topic keywords for search (flat list, omitted when empty/unset). */
  topics?: string[];
  now?: Date;
}

function buildNoteContent(text: string, topics?: string[]): string {
  if (!topics || topics.length === 0) return text;
  const items = topics.map((t) => yamlDoubleQuoted(t)).join(", ");
  return `---\ntopics: [${items}]\n---\n\n${text}`;
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
  const content = buildNoteContent(text, options.topics);
  return writeUniqueMarkdown(notesDir, basename, content);
}
