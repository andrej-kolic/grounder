import { readFile } from "node:fs/promises";
import { hashContent } from "../util/hash.js";
import type { DiskHashes } from "./core.js";

/** Read + hash each path; absent/unreadable files map to `undefined`. */
export async function readDiskHashes(paths: Iterable<string>): Promise<DiskHashes> {
  const out: DiskHashes = {};
  for (const p of paths) {
    try {
      out[p] = hashContent(await readFile(p, "utf8"));
    } catch {
      out[p] = undefined;
    }
  }
  return out;
}
