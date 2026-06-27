import {
  readHomeConfig,
  readRepoConfig,
} from "../config.js";
import { findGitRoot } from "../detect.js";
import { resolveNotesDir } from "../paths.js";

export async function runPathNotes(argv: string[]): Promise<number> {
  const cwd = process.cwd();
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
  process.stdout.write(`${notesDir}\n`);
  return 0;
}
