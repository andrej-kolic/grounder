import { readHomeConfig, withHomeDir } from "../connector/home.js";
import { findGitRoot } from "../connector/git.js";
import { findLinkedRepoRoot, readRepoConfig } from "../connector/repo.js";
import { resolveNotesDir } from "../connector/vault.js";
import { writeNote } from "../vault/write-note.js";
import { flagString, parseArgs } from "../util/parse-args.js";

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
    const cwd = options.cwd ?? process.cwd();
    const gitRoot = await findGitRoot(cwd);

    const home = await readHomeConfig();
    if (!home) {
      process.stderr.write("No vault configured. Run: grounder vault init <path>\n");
      return 1;
    }

    const linkedRoot = await findLinkedRepoRoot(cwd, gitRoot);
    if (!linkedRoot) {
      process.stderr.write("Folder not linked. Run: grounder init\n");
      return 1;
    }

    const repo = await readRepoConfig(linkedRoot);
    if (!repo) {
      process.stderr.write("Folder not linked. Run: grounder init\n");
      return 1;
    }

    const notesDir = resolveNotesDir(home, repo);
    const writtenPath = await writeNote(notesDir, options.text, {
      title: options.title,
      now: options.now,
    });

    process.stdout.write(`Wrote ${writtenPath}\n`);
    return 0;
  });
}
