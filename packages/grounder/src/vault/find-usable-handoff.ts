import { readFile } from "node:fs/promises";
import { listHandoffs } from "./list-handoffs.js";

/** Newest-first candidates scanned for a usable handoff before giving up. */
const DEFAULT_SCAN_LIMIT = 5;

export interface FindUsableHandoffOptions {
  /** Max newest-first candidates to scan (default: 5). */
  limit?: number;
}

export interface UsableHandoff {
  /** Absolute path of the resolved handoff file. */
  path: string;
  /** Already-read file contents (avoids a second read by callers). */
  content: string;
}

/**
 * Resolves the newest-first handoff under `logsDir` that actually has content,
 * skipping empty or unreadable files along the way (e.g. an interrupted write).
 * Single source of truth for "which handoff is current" — shared by
 * `grounder handoff peek` and `grounder handoff list --head` so both agree.
 * Returns `undefined` when no candidate within the scan window is usable.
 */
export async function findUsableHandoff(
  logsDir: string,
  options: FindUsableHandoffOptions = {},
): Promise<UsableHandoff | undefined> {
  const paths = await listHandoffs(logsDir, { limit: options.limit ?? DEFAULT_SCAN_LIMIT });
  for (const filePath of paths) {
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    if (content.trim().length > 0) {
      return { path: filePath, content };
    }
  }
  return undefined;
}
