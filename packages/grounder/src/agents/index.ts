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
