import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../util/fs.js";
import {
  timestampedBasename,
  timestampedBasenameWithSeconds,
} from "../util/timestamp-slug.js";

export interface WriteNoteOptions {
  title?: string;
  now?: Date;
}

async function resolveNotePath(
  notesDir: string,
  text: string,
  options: WriteNoteOptions,
): Promise<string> {
  const now = options.now ?? new Date();
  const slugOptions = { title: options.title, now };
  let basename = timestampedBasename(text, slugOptions);
  let filePath = path.join(notesDir, `${basename}.md`);

  if (await fileExists(filePath)) {
    basename = timestampedBasenameWithSeconds(text, slugOptions);
    filePath = path.join(notesDir, `${basename}.md`);
  }

  if (await fileExists(filePath)) {
    let n = 2;
    while (await fileExists(path.join(notesDir, `${basename}-${n}.md`))) {
      n += 1;
    }
    filePath = path.join(notesDir, `${basename}-${n}.md`);
  }

  return filePath;
}

export async function writeNote(
  notesDir: string,
  text: string,
  options: WriteNoteOptions = {},
): Promise<string> {
  const now = options.now ?? new Date();
  await mkdir(notesDir, { recursive: true });

  const filePath = await resolveNotePath(notesDir, text, options);
  await writeFile(filePath, text, "utf8");
  return filePath;
}
