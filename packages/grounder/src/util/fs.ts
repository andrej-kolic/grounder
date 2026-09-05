import { access, chmod, constants, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { collisionSuffix } from "./timestamp-slug.js";

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when `filePath` is present and executable (`X_OK`).
 * On Windows, `X_OK` effectively degrades toward existence — callers should
 * not oversell POSIX execute-bit semantics there.
 */
export async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write `content` to `filePath` via tmp file + rename, so a crash mid-write
 * never leaves a truncated file at the real path. Creates the destination
 * directory if needed; best-effort removes the tmp file if `rename` itself
 * throws, so a failed write doesn't leave an orphaned `.tmp-*` sibling behind.
 * `mode` (e.g. the pre-existing file's permission bits), when given, is
 * applied to the tmp file before the rename — otherwise the replaced file
 * would pick up the tmp file's default umask permissions instead of keeping
 * whatever the file already had, which matters for host-owned config files
 * edited by other tools.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  options: { mode?: number } = {},
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, content, "utf8");
  if (options.mode !== undefined) {
    await chmod(tmpPath, options.mode);
  }
  try {
    await rename(tmpPath, filePath);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
}

/**
 * Creates a new markdown file under `dir`; never overwrites.
 * Tries `basename.md`, then `basename_02.md`, `_03`, … with `wx` (O_EXCL)
 * so concurrent writers cannot clobber each other.
 */
export async function writeUniqueMarkdown(
  dir: string,
  basename: string,
  content: string,
): Promise<string> {
  let n = 0;
  for (;;) {
    const stem = n === 0 ? basename : `${basename}${collisionSuffix(n)}`;
    const filePath = path.join(dir, `${stem}.md`);
    try {
      await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
      return filePath;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        n = n === 0 ? 2 : n + 1;
        continue;
      }
      throw error;
    }
  }
}
