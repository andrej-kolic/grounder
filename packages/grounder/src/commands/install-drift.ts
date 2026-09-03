import { ALL_AGENTS } from "../agents/index.js";
import { type GrounderState, ledgerFilesFor } from "../connector/state.js";
import { desiredDrift } from "../reconcile/core.js";
import { hashContent } from "../util/hash.js";

/**
 * Cheap "would migrate change something" check for `peek`/`status`: no
 * Cursor/Claude host-file I/O, just a package-local template render + hash
 * per ledger-recorded agent, diffed against `state.json`'s `files` map.
 * Scoped to agents already present in the ledger — a detected-but-never-set-up
 * agent produces no drift here (see `desiredDrift`'s own scoping rule), so
 * this never teases `migrate` forever with no command able to silence it.
 */
export async function installDriftDetected(
  state: GrounderState | null,
  homeDir?: string,
): Promise<boolean> {
  if (!state) {
    return false;
  }
  for (const agent of ALL_AGENTS) {
    const ledgerFiles = ledgerFilesFor(state, agent.id);
    if (!ledgerFiles) {
      continue;
    }
    const desired = await agent.desiredArtifacts(homeDir);
    const desiredHashes: Record<string, string> = {};
    for (const [p, content] of Object.entries(desired)) {
      desiredHashes[p] = hashContent(content);
    }
    if (desiredDrift(desiredHashes, ledgerFiles).length > 0) {
      return true;
    }
  }
  return false;
}
