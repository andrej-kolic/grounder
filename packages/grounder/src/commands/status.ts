import path from "node:path";
import { currentBranch, findGitRoot } from "../connector/git.js";
import { homeConfigPath, readHomeConfig, withHomeDir } from "../connector/home.js";
import {
  findLinkedRepoRoot,
  type RepoConfig,
  readRepoConfig,
  repoConfigPath,
} from "../connector/repo.js";
import { resolveLogsDir, resolveNotesDir, resolveVaultRoot } from "../connector/vault.js";

export interface StatusOptions {
  cwd?: string;
  homeDir?: string;
}

const LABEL_WIDTH = 12;

function section(title: string): string {
  return `${title}\n`;
}

function statusLine(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}\n`;
}

async function writeGitLine(gitRoot: string | null): Promise<void> {
  if (!gitRoot) {
    return;
  }
  const branch = await currentBranch(gitRoot);
  const gitValue = branch !== undefined ? `${gitRoot}  (branch: ${branch})` : gitRoot;
  process.stdout.write(statusLine("Git:", gitValue));
}

export async function runStatus(_argv: string[]): Promise<number> {
  return runStatusWithOptions({});
}

export async function runStatusWithOptions(options: StatusOptions = {}): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const home = await readHomeConfig();
    const gitRoot = await findGitRoot(cwd);
    const linkedRoot = await findLinkedRepoRoot(cwd, gitRoot);
    const repo: RepoConfig | null = linkedRoot ? await readRepoConfig(linkedRoot) : null;

    process.stdout.write(section("Machine"));
    if (!home) {
      process.stdout.write(statusLine("Config:", "missing → run: grounder vault init <path>"));
    } else {
      process.stdout.write(statusLine("Config:", homeConfigPath()));
      process.stdout.write(statusLine("Vault:", resolveVaultRoot(home)));
    }

    process.stdout.write("\n");
    process.stdout.write(section("Project"));

    if (!repo || !linkedRoot) {
      process.stdout.write(statusLine("Linked:", "no"));
      if (home) {
        process.stdout.write(statusLine("Config:", "missing → run: grounder init"));
      }
      return 0;
    }

    if (!home) {
      process.stdout.write(statusLine("Linked:", "incomplete → run: grounder vault init <path>"));
      process.stdout.write(statusLine("Folder:", linkedRoot));
      process.stdout.write(statusLine("Config:", repoConfigPath(linkedRoot)));
      process.stdout.write(statusLine("Id:", repo.projectId));
      await writeGitLine(gitRoot);
      return 0;
    }

    process.stdout.write(statusLine("Linked:", "yes"));
    process.stdout.write(statusLine("Folder:", linkedRoot));
    process.stdout.write(statusLine("Config:", repoConfigPath(linkedRoot)));
    process.stdout.write(statusLine("Id:", repo.projectId));
    process.stdout.write(statusLine("Notes:", resolveNotesDir(home, repo)));
    process.stdout.write(statusLine("Logs:", resolveLogsDir(home, repo)));
    await writeGitLine(gitRoot);

    return 0;
  });
}
