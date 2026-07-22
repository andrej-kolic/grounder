import { readHomeConfig, withHomeDir } from "../../connector/home.js";
import { findGitRoot } from "../../connector/git.js";
import { findLinkedRepoRoot, readRepoConfig } from "../../connector/repo.js";
import { resolveLogsDir } from "../../connector/vault.js";

export interface PathLogsOptions {
  cwd?: string;
  homeDir?: string;
}

export async function runPathLogs(_argv: string[]): Promise<number> {
  return runPathLogsWithOptions({});
}

export async function runPathLogsWithOptions(
  options: PathLogsOptions = {},
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

    const dir = resolveLogsDir(home, repo);
    process.stdout.write(`${dir}\n`);
    return 0;
  });
}
