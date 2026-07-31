import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "./fs.js";

export type MergeJsonResult =
  | { ok: true; created: boolean }
  | { ok: false; error: "unparseable"; message: string };

/**
 * Read a JSON object file (default `{}` if missing), apply `merge`, write pretty-printed.
 * On parse failure or non-object root: leaves the file untouched and returns an error
 * so callers can warn without clobbering shared config.
 */
export async function mergeJsonFile(
  filePath: string,
  merge: (current: Record<string, unknown>) => Record<string, unknown>,
): Promise<MergeJsonResult> {
  const existed = await fileExists(filePath);
  let current: Record<string, unknown> = {};

  if (existed) {
    const raw = await readFile(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
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
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { ok: true, created: !existed };
}
