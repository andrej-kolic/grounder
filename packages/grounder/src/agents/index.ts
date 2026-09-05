import type { AgentFileState } from "../connector/state.js";
import { isUnderOwnedPrefix } from "../reconcile/core.js";
import { claude } from "./claude.js";
import { cursor } from "./cursor.js";
import type { AgentAdapter } from "./types.js";

export { claude } from "./claude.js";
export { cursor } from "./cursor.js";
export type {
  AgentAdapter,
  AgentInstallOptions,
  AgentInstallResult,
  ArtifactStatus,
} from "./types.js";

/** Every agent adapter this Grounder build knows about (Cursor, Claude, …). */
export const ALL_AGENTS: readonly AgentAdapter[] = [cursor, claude];

/**
 * Resolve which adapters to run:
 *  - If `ids` is provided, return those adapters (throws on unknown id).
 *  - Otherwise, auto-detect by checking isInstalled() for each adapter.
 */
export async function resolveAgents(ids?: string[]): Promise<AgentAdapter[]> {
  if (ids && ids.length > 0) {
    const found = ALL_AGENTS.filter((a) => ids.includes(a.id));
    const unknown = ids.filter((id) => !ALL_AGENTS.some((a) => a.id === id));
    if (unknown.length > 0) {
      throw new Error(`Unknown agent id(s): ${unknown.join(", ")}`);
    }
    return found;
  }

  const results = await Promise.all(
    ALL_AGENTS.map(async (a) => ({ adapter: a, ok: await a.isInstalled() })),
  );
  return results.filter((r) => r.ok).map((r) => r.adapter);
}

/**
 * Restrict a ledger-recorded agent's file manifest to paths under this
 * adapter's own {@link AgentAdapter.ownedPrefixes} before it ever reaches
 * `reconcile()`. Defends a known agent's `state.json` entry against becoming
 * a delete/forget candidate for a path this binary doesn't actually manage
 * for it — a stray or hand-edited entry stays in the ledger, untouched,
 * rather than being planned against.
 */
export function ownedLedgerFiles(
  agent: AgentAdapter,
  ledgerFiles: Record<string, AgentFileState> | undefined,
  homeDir?: string,
): Record<string, AgentFileState> | undefined {
  if (!ledgerFiles) {
    return ledgerFiles;
  }
  const owned = agent.ownedPrefixes(homeDir);
  return Object.fromEntries(
    Object.entries(ledgerFiles).filter(([p]) => isUnderOwnedPrefix(p, owned)),
  );
}
