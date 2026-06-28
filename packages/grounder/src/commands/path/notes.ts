import { readHomeConfig, withHomeDir } from "../../connector/home.js";
import { findGitRoot } from "../../connector/git.js";
import { findLinkedRepoRoot, readRepoConfig } from "../../connector/repo.js";
import { resolveNotesDir } from "../../connector/vault.js";

export interface PathNotesOptions {
  cwd?: string;
  homeDir?: string;
}

export async function runPathNotes(_argv: string[]): Promise<number> {
  return runPathNotesWithOptions({});
}

export async function runPathNotesWithOptions(
  options: PathNotesOptions = {},
): Promise<number> {
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
    process.stdout.write(`${notesDir}\n`);
    return 0;
  });
}
