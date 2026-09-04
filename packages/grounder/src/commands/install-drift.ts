import { ALL_AGENTS, ownedLedgerFiles } from "../agents/index.js";
import { type GrounderState, ledgerFilesFor } from "../connector/state.js";
import { desiredDrift } from "../reconcile/core.js";
import { hashContent } from "../util/hash.js";

/**
 * Cheap "would migrate change something" check for `peek`/`status`: no
 * Cursor/Claude host-file I/O, just a package-local template render + hash
 * per ledger-recorded agent, diffed against `state.json`'s `files` map, plus
 * one ledger-only lookup for tombstoned legacy paths still on record.
 * Scoped to agents already present in the ledger — a detected-but-never-set-up
 * agent produces no drift here (see `desiredDrift`'s own scoping rule), so
 * this never teases `migrate` forever with no command able to silence it.
 *
 * `ledgerFiles` is run through `ownedLedgerFiles()` first, same as
 * `migrate`/`doctor`/`applyPlan()` — a stray key outside the adapter's
 * `ownedPrefixes` (a hand-edited or corrupted `state.json` entry) is invisible
 * to `reconcile()` and refused on apply, so counting it as drift here would
 * nag `migrate` forever for a path `migrate` will never actually touch.
 *
 * A tombstoned path still present in the ledger's `files` map means `migrate`
 * has something to retire (delete, forget, or a conflict needing `--force`) —
 * checking that is a plain key lookup against data already in memory, not a
 * disk read, so it stays as cheap as the hash diff above. Doctor's own
 * `agent-*-legacy-commands` check is the one place that actually reads disk
 * to tell delete/conflict/already-gone apart; this only answers "is migrate
 * a no-op," which none of those three are.
 *
 * An owned ledger key that is neither desired nor tombstoned (a skill dropped
 * from the current release with nobody remembering to tombstone the old path)
 * is the same kind of drift: `reconcile()` never plans a non-desired ledger
 * path as `noop`, so `migrate` always has something to do with it (forget it
 * if already gone from disk, else delete/conflict). Same plain key-lookup
 * cost as the tombstone check above — no disk read needed to know *that*
 * there's drift, only to know which of forget/delete/conflict it'll be.
 */
export async function installDriftDetected(
  state: GrounderState | null,
  homeDir?: string,
): Promise<boolean> {
  if (!state) {
    return false;
  }
  for (const agent of ALL_AGENTS) {
    const ledgerFiles = ownedLedgerFiles(agent, ledgerFilesFor(state, agent.id), homeDir);
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
    const tombstonePaths = new Set(agent.tombstones(homeDir));
    if ([...tombstonePaths].some((p) => p in ledgerFiles)) {
      return true;
    }
    const desiredPaths = new Set(Object.keys(desiredHashes));
    if (Object.keys(ledgerFiles).some((p) => !desiredPaths.has(p) && !tombstonePaths.has(p))) {
      return true;
    }
  }
  return false;
}
