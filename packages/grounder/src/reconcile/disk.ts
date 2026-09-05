import { readFile } from "node:fs/promises";
import { hashContent } from "../util/hash.js";
import type { DiskHashes } from "./core.js";

/**
 * Read + hash each path; a missing file maps to `undefined`. Any other read
 * failure (EACCES, EISDIR, …) propagates instead of being folded into
 * "missing" — an unreadable-but-present file must never be silently planned
 * as a `create`, writing blind over content this binary never actually saw.
 * Both callers already have somewhere for that to land gracefully: doctor's
 * `computeAgentPlansSafe` catches per-agent and turns it into a "could not
 * verify skill drift" warning; `setup`/`migrate` catch it around
 * `applyAgentInstalls` and report it on stderr.
 */
export async function readDiskHashes(paths: Iterable<string>): Promise<DiskHashes> {
  const out: DiskHashes = {};
  for (const p of paths) {
    try {
      out[p] = hashContent(await readFile(p, "utf8"));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      out[p] = undefined;
    }
  }
  return out;
}
