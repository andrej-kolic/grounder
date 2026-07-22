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
 * Walks upward from `startDir` looking for a `.git` entry.
 * @returns Absolute git root, or `null` if none is found.
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
 * Best-effort branch name via `git rev-parse --abbrev-ref HEAD`.
 * @returns Branch name, or `undefined` if git fails / output is empty
 *   / detached HEAD (`abbrev-ref` prints `HEAD`), etc.
 */
export async function currentBranch(gitRoot: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: gitRoot, encoding: "utf8" },
    );
    const branch = String(stdout).trim();
    if (!branch || branch === "HEAD") {
      return undefined;
    }
    return branch;
  } catch {
    return undefined;
  }
}
