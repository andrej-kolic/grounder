import {
  hookFileHasGrounderEntry,
  installHookRuntime,
  isHookRuntimeStale,
  runtimeCliPath,
  runtimeMode,
} from "../agents/hook-runtime.js";
import type { AgentAdapter, AgentInstallResult, ArtifactStatus } from "../agents/types.js";
import {
  assertVersionSupportsWrite,
  ledgerFilesFor,
  readGrounderState,
  recordedHooksEnabled,
  setHooksEnabled,
} from "../connector/state.js";
import { applyPlan } from "../reconcile/apply.js";
import { type PlanEntry, planChangesLedger, reconcile } from "../reconcile/core.js";
import { readDiskHashes } from "../reconcile/disk.js";
import { fileExists } from "../util/fs.js";
import { hashContent } from "../util/hash.js";

export interface ApplyAgentInstallsOptions {
  agents: AgentAdapter[];
  force?: boolean;
  /** Explicitly install/refresh session hooks (setup --hooks / migrate --hooks). */
  hooks?: boolean;
  /**
   * When true (migrate), also refresh hooks that were previously enabled or
   * already present on disk — without installing hooks for agents that never
   * opted in.
   */
  refreshInstalledHooks?: boolean;
  dryRun?: boolean;
  homeDir?: string;
  /** Running package version — recorded in the ledger and checked on the write path. */
  grounderVersion: string;
}

export interface AgentApplyResult {
  agent: AgentAdapter;
  plan: PlanEntry[];
  hooks?: AgentInstallResult;
  /** Would/did this agent's install change `~/.grounder/state.json`? */
  ledgerChanged: boolean;
}

export interface ApplyAgentInstallsResult {
  runtime?: { cliPath: string; status: ArtifactStatus; mode: "symlink" | "copy" };
  agents: AgentApplyResult[];
}

async function agentHasInstalledHooks(agent: AgentAdapter, homeDir?: string): Promise<boolean> {
  if (!agent.expectedHookArtifacts) {
    return false;
  }
  const paths = agent.expectedHookArtifacts(homeDir);
  for (const p of paths) {
    if (await hookFileHasGrounderEntry(p)) {
      return true;
    }
  }
  return false;
}

/**
 * `hooksEnabled` tri-state drives whether a plain (no `--hooks`) migrate
 * refreshes hooks: `true` → refresh, `false` → never (sticky opt-out),
 * `undefined` → fall back to an on-disk recognizer match (legacy ledger, or
 * hooks installed before the ledger tracked them at all).
 */
async function shouldInstallHooks(
  agent: AgentAdapter,
  opts: Pick<ApplyAgentInstallsOptions, "hooks" | "refreshInstalledHooks" | "homeDir">,
  hooksEnabled: boolean | undefined,
): Promise<boolean> {
  if (!agent.installHooks) {
    return false;
  }
  if (opts.hooks) {
    return true;
  }
  if (!opts.refreshInstalledHooks) {
    return false;
  }
  if (hooksEnabled !== undefined) {
    return hooksEnabled;
  }
  return agentHasInstalledHooks(agent, opts.homeDir);
}

/**
 * Materialize runtime + install/refresh agent whole-file artifacts (and
 * optional hooks). Shared by `grounder setup` and `grounder migrate`, both of
 * which render the result themselves via `render-artifact-table.ts`.
 *
 * `--dry-run` = compute plans and preview, never call `applyPlan()` or write
 * hooks/ledger.
 */
export async function applyAgentInstalls(
  opts: ApplyAgentInstallsOptions,
): Promise<ApplyAgentInstallsResult> {
  const force = opts.force ?? false;
  const dryRun = opts.dryRun ?? false;
  const homeDir = opts.homeDir;
  const agents = opts.agents;
  const state = await readGrounderState(homeDir);

  if (!dryRun) {
    assertVersionSupportsWrite(opts.grounderVersion, state);
  }

  let runtime: ApplyAgentInstallsResult["runtime"];
  if (agents.length > 0) {
    const cliPath = runtimeCliPath(homeDir);
    // Grounder owns this directory outright (no user edits to protect), so
    // `force` isn't needed to justify a reinstall — only actual staleness is.
    const stale = await isHookRuntimeStale(homeDir);
    if (!stale) {
      runtime = { cliPath, status: "skipped", mode: runtimeMode() };
    } else if (dryRun) {
      runtime = {
        cliPath,
        status: (await fileExists(cliPath)) ? "overwritten" : "created",
        mode: runtimeMode(),
      };
    } else {
      runtime = await installHookRuntime({ homeDir });
    }
  }

  const results: AgentApplyResult[] = [];

  for (const agent of agents) {
    const desired = await agent.desiredArtifacts(homeDir);
    const tombstones = agent.tombstones(homeDir);
    const ledgerFiles = ledgerFilesFor(state, agent.id);
    const diskPaths = new Set<string>([
      ...Object.keys(desired),
      ...Object.keys(ledgerFiles ?? {}),
      ...tombstones,
    ]);
    const disk = await readDiskHashes(diskPaths);
    const desiredHashes: Record<string, string> = {};
    for (const [p, content] of Object.entries(desired)) {
      desiredHashes[p] = hashContent(content);
    }

    const plan = reconcile(desiredHashes, tombstones, ledgerFiles, disk, force);

    if (!dryRun) {
      await applyPlan({
        agentId: agent.id,
        plan,
        content: desired,
        grounderVersion: opts.grounderVersion,
        homeDir,
      });
    }

    // A tombstoned path that's simply already gone (`noop`) carries nothing
    // actionable — drop it from the table-facing plan (matches the old
    // migration runner's "already-absent stays unreported"). Every other
    // outcome, including a desired path's own `noop`, stays visible.
    const desiredPaths = new Set(Object.keys(desired));
    const visiblePlan = plan.filter(
      (entry) => desiredPaths.has(entry.path) || entry.action !== "noop",
    );

    const hooksEnabled = recordedHooksEnabled(state, agent.id);
    let hooksResult: AgentInstallResult | undefined;
    let hooksLedgerChanged = false;
    if (await shouldInstallHooks(agent, opts, hooksEnabled)) {
      const installHooksFn = agent.installHooks;
      if (installHooksFn) {
        hooksResult = await installHooksFn({ force, dryRun, homeDir });
        if (hooksEnabled !== true) {
          hooksLedgerChanged = true;
          if (!dryRun) {
            await setHooksEnabled({
              agentId: agent.id,
              enabled: true,
              grounderVersion: opts.grounderVersion,
              homeDir,
            });
          }
        }
      }
    }

    const ledgerChanged = planChangesLedger(plan, ledgerFiles, desiredHashes) || hooksLedgerChanged;

    results.push({ agent, plan: visiblePlan, hooks: hooksResult, ledgerChanged });
  }

  return { runtime, agents: results };
}
