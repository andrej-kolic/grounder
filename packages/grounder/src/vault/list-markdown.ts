import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Recursively lists `*.md` files under `rootDir` (absolute paths).
 * Missing dirs yield `[]`. Does not follow directory symlinks (`Dirent`
 * type checks); plain files that are symlinks to `.md` are included when
 * `isFile()` reports true.
 */
export async function listMarkdownFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(full);
      }
    }
  }

  await walk(rootDir);
  return results;
}
