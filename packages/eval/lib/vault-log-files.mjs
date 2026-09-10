import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Basenames currently in a mode-lock sandbox vault's `logs/` dir (empty set
 * if the dir doesn't exist yet — it's created lazily on first write).
 *
 * This is the ground truth for the mode-lock write boundary: did a probe
 * actually add a file to the vault, regardless of *how* — the CLI, a raw
 * Bash redirect, or a cursor-agent Write/Edit/Delete tool call. Grading off
 * command text instead (a `handoff` substring, a tracked tool-call shape)
 * is what let a `cat .../grounder-handoff/SKILL.md` false-fail a recall
 * probe and a Claude `cat > .../logs/x.md` false-pass one — neither
 * mentions "handoff" as its own action, and Claude's non-Bash tools aren't
 * tracked at all. A file either landed in `logs/` or it didn't.
 */
export async function listLogFiles(vaultDir) {
  const logsDir = path.join(vaultDir, "10-Projects", "eval-mode-lock", "logs");
  try {
    return new Set(await readdir(logsDir));
  } catch (error) {
    if (error.code === "ENOENT") {
      return new Set();
    }
    throw error;
  }
}

/** Did any file appear in `after` that wasn't in `before`? (Never used to detect removal — mode-lock probes only ever add.) */
export function hasNewFile(before, after) {
  for (const name of after) {
    if (!before.has(name)) {
      return true;
    }
  }
  return false;
}
