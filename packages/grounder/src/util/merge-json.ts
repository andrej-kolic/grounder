import { readFile, stat } from "node:fs/promises";
import { fileExists, writeFileAtomic } from "./fs.js";

export type MergeJsonResult =
  | { ok: true; created: boolean; changed: boolean }
  | { ok: false; error: "unparseable"; message: string };

export interface MergeJsonFileOptions {
  /** Compute the result without writing to disk. */
  dryRun?: boolean;
}

/**
 * Read a JSON object file (default `{}` if missing), apply `merge`, write pretty-printed —
 * only when the merged content actually differs from what's on disk, so callers can trust
 * `changed` to mean a real content change rather than "we ran the merge function."
 * A `merge` that returns its `current` argument by reference is treated as a no-op and
 * never writes, even if the file's on-disk formatting (indentation, line endings, key
 * order) differs from `JSON.stringify(current, null, 2)` — callers rely on this to leave
 * a file with nothing to change byte-for-byte untouched instead of reformatting it.
 * On parse failure or non-object root: leaves the file untouched and returns an error
 * so callers can warn without clobbering shared config.
 */
export async function mergeJsonFile(
  filePath: string,
  merge: (current: Record<string, unknown>) => Record<string, unknown>,
  options: MergeJsonFileOptions = {},
): Promise<MergeJsonResult> {
  const existed = await fileExists(filePath);
  let current: Record<string, unknown> = {};
  let originalRaw: string | undefined;

  if (existed) {
    originalRaw = await readFile(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(originalRaw);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: "unparseable",
        message: `Refusing to modify ${filePath}: invalid JSON (${detail})`,
      };
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: "unparseable",
        message: `Refusing to modify ${filePath}: root value must be a JSON object`,
      };
    }

    current = parsed as Record<string, unknown>;
  }

  const next = merge(current);
  const nextRaw = `${JSON.stringify(next, null, 2)}\n`;
  const changed = next !== current && nextRaw !== originalRaw;

  if (changed && !options.dryRun) {
    // Preserve the existing file's permission bits across the tmp+rename
    // swap — these are host-owned config files (Cursor/Claude Code), not
    // Grounder's own state, so a rename shouldn't reset them to the tmp
    // file's default umask.
    const mode = existed ? (await stat(filePath)).mode & 0o777 : undefined;
    await writeFileAtomic(filePath, nextRaw, mode !== undefined ? { mode } : {});
  }
  return { ok: true, created: !existed, changed };
}
