import { withHomeDir } from "../connector/home.js";
import { resolveNotesDir } from "../connector/vault.js";
import { flagString, parseArgs } from "../util/parse-args.js";
import { writeNote } from "../vault/write-note.js";
import { requireLinkedProject } from "./require-linked.js";

export interface NoteOptions {
  cwd?: string;
  text: string;
  title?: string;
  homeDir?: string;
  now?: Date;
}

export async function runNote(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const text = positional.join(" ").trim();

  if (!text) {
    process.stderr.write("Usage: grounder note <text>\n");
    return 1;
  }

  return runNoteWithOptions({
    text,
    title: flagString(flags, "title"),
  });
}

export async function runNoteWithOptions(options: NoteOptions): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const linked = await requireLinkedProject(options.cwd ?? process.cwd());
    if (!linked) {
      return 1;
    }

    const notesDir = resolveNotesDir(linked.home, linked.repo);
    const writtenPath = await writeNote(notesDir, options.text, {
      title: options.title,
      now: options.now,
    });

    process.stdout.write(`Wrote ${writtenPath}\n`);
    return 0;
  });
}
