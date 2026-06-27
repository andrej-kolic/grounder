import {
  readHomeConfig,
  readRepoConfig,
} from "../config.js";
import { findGitRoot } from "../detect.js";
import { resolveNotesDir } from "../paths.js";
import { writeNote } from "../vault/write-note.js";
import { flagString, parseArgs } from "../util/parse-args.js";

export interface NoteOptions {
  cwd?: string;
  text: string;
  title?: string;
  homeDir?: string;
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
  const cwd = options.cwd ?? process.cwd();

  if (options.homeDir) {
    process.env.GROUNDER_HOME = options.homeDir;
  }

  const gitRoot = await findGitRoot(cwd);
  if (!gitRoot) {
    process.stderr.write("Not inside a git repository.\n");
    return 1;
  }

  const home = await readHomeConfig();
  if (!home) {
    process.stderr.write("No vault configured. Run: grounder vault init <path>\n");
    return 1;
  }

  const repo = await readRepoConfig(gitRoot);
  if (!repo) {
    process.stderr.write("Repo not linked. Run: grounder init\n");
    return 1;
  }

  const notesDir = resolveNotesDir(home, repo);
  const writtenPath = await writeNote(notesDir, options.text, {
    title: options.title,
  });

  process.stdout.write(`Wrote ${writtenPath}\n`);
  return 0;
}
