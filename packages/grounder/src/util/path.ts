import os from "node:os";
import path from "node:path";

/**
 * Expand a leading `~` / `~/…` to the user home directory.
 * Leaves other paths unchanged (including a mid-path `~`, which is not home).
 */
export function expandHome(input: string): string {
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/") || input.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

/**
 * Expand a leading `~`, then resolve to an absolute path (relative to `cwd` if given).
 */
export function resolveUserPath(input: string, cwd: string = process.cwd()): string {
  return path.resolve(cwd, expandHome(input));
}
