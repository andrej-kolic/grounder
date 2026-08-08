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

/**
 * True when `child` resolves to a path strictly inside `parent` (or equal to it).
 * Uses resolved absolute paths; rejects `..` escape and cross-root relatives.
 */
export function isPathInside(parent: string, child: string): boolean {
  const root = path.resolve(parent);
  const target = path.resolve(child);
  if (root === target) {
    return true;
  }
  const relative = path.relative(root, target);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
