import { access, writeFile } from "node:fs/promises";
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
