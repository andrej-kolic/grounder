import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

async function isGitRoot(dir: string): Promise<boolean> {
  try {
    await access(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}


/**
 * Finds the git root directory for a given start directory.
 * Searches upwards from the start directory, stops at the root directory.
 * @param startDir - The directory to start searching from.
 * @returns The git root directory, or null if not found.
 */
export async function findGitRoot(startDir: string): Promise<string | null> {
  let current = path.resolve(startDir);

  while (true) {
    if (await isGitRoot(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Best-effort current branch name for a git root.
 * Returns undefined when git fails or the name is empty.
 */
export async function currentBranch(gitRoot: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: gitRoot, encoding: "utf8" },
    );
    const branch = String(stdout).trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}
