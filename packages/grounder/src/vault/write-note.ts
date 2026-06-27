import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../util/fs.js";
import { slugifyText, timeSuffix, timestampSlug } from "../util/note-slug.js";

export interface WriteNoteOptions {
  title?: string;
  now?: Date;
}

function baseSlug(text: string, title: string | undefined, now: Date): string {
  if (title) {
    return slugifyText(title);
  }

  const fromText = slugifyText(text);
  return fromText || timestampSlug(now);
}

export async function writeNote(
  notesDir: string,
  text: string,
  options: WriteNoteOptions = {},
): Promise<string> {
  const now = options.now ?? new Date();
  await mkdir(notesDir, { recursive: true });

  let slug = baseSlug(text, options.title, now);
  let filePath = path.join(notesDir, `${slug}.md`);

  if (await fileExists(filePath)) {
    slug = `${slug}-${timeSuffix(now)}`;
    filePath = path.join(notesDir, `${slug}.md`);
  }

  await writeFile(filePath, text, "utf8");
  return filePath;
}
