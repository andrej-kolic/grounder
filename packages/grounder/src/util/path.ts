import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
 * True when `child` is inside `parent` (or equal), using lexical `path.resolve` only
 * (does not follow symlinks). Rejects `..` escape and cross-root relatives.
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

/**
 * True when `child`'s real path is strictly inside `parent` (symlinks followed).
 * Returns `null` if either path cannot be resolved (e.g. missing).
 */
export async function isRealPathInside(parent: string, child: string): Promise<boolean | null> {
  try {
    const root = await realpath(parent);
    const target = await realpath(child);
    return root !== target && isPathInside(root, target);
  } catch {
    return null;
  }
}

/** `file://` href for an absolute filesystem path (spaces percent-encoded). */
export function toFileUri(filePath: string): string {
  return pathToFileURL(filePath).href;
}

/**
 * Path relative to a vault/project root, always with `/` separators
 * (stable for markdown links and JSON across platforms).
 */
export function vaultRelativePath(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}
