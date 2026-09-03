import {
  readGrounderState,
  recordAgentInstall,
  wouldChangeGrounderState,
} from "../connector/state.js";
import { VERSION } from "../index.js";
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
 * Write this agent's install version info into `~/.grounder/state.json` after
 * install. If hooks were installed and the agent supports them, store the hooks
 * version; otherwise leave any existing hooks version as-is.
 *
 * When `advanceCommandsSchema` is false (every skill file was left alone
 * because it looked locally edited or from an old install), do not bump the
 * commands version in state — otherwise doctor/peek would stop warning even
 * though the files were never updated. Use `--force` (or a real write) first.
 *
 * Returns whether the ledger would change (real run: did change). Callable
 * under `--dry-run` too — same {@link wouldChangeGrounderState} predicate
 * decides both whether to write and what to report, so a preview can never
 * disagree with what a real run would do.
 */
export async function recordAgentInstallState(
  agent: AgentAdapter,
  opts: {
    hooksInstalled?: boolean;
    homeDir?: string;
    /** Default true. Pass false when no skill file was written or already up to date. */
    advanceCommandsSchema?: boolean;
    dryRun?: boolean;
  } = {},
): Promise<boolean> {
  const advanceCommandsSchema = opts.advanceCommandsSchema !== false;
  const installOpts = {
    agentId: agent.id,
    ...(advanceCommandsSchema ? { commandsSchema: agent.commandsSchema } : {}),
    hooksSchema:
      opts.hooksInstalled && agent.hooksSchema !== undefined ? agent.hooksSchema : undefined,
    grounderVersion: VERSION,
    homeDir: opts.homeDir,
  };
  const existing = await readGrounderState(opts.homeDir);
  const changed = wouldChangeGrounderState(existing, installOpts);
  if (changed && !opts.dryRun) {
    await recordAgentInstall(installOpts);
  }
  return changed;
}
