import {
  hookFileHasGrounderEntry,
  installHookRuntime,
  isHookRuntimeStale,
  runtimeCliPath,
  runtimeMode,
} from "../agents/hook-runtime.js";
import { ownedLedgerFiles } from "../agents/index.js";
import type { AgentAdapter, AgentInstallResult, ArtifactStatus } from "../agents/types.js";
import {
  assertVersionSupportsWrite,
  ledgerFilesFor,
  readGrounderState,
  recordedHooksEnabled,
  setHooksEnabled,
  touchGrounderVersion,
} from "../connector/state.js";
import { isUnsupportedSchemaError } from "../connector/unsupported-schema.js";
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
   * Explicitly turn hooks off (`migrate --no-hooks`) — removes the fragment
   * and flips `hooksEnabled` to `false` (sticky: a later plain `migrate`
   * will not re-hydrate it). Mutually exclusive with `hooks` in practice
   * (the CLI layer rejects both at once); if both are somehow set, `hooks`
   * wins for that one call.
   */
  noHooks?: boolean;
  /**
   * When true (migrate), also refresh hooks that were previously enabled or
   * already present on disk — without installing hooks for agents that never
   * opted in.
   */
  refreshInstalledHooks?: boolean;
  /**
   * Retire tombstoned legacy paths (pre-skill `grounder-*.md` command files).
   * Defaults to `true` (`migrate`'s behavior). `setup` passes `false` — per
   * `docs/upgrading.md`, `setup --force` is a documented repair path that
   * never deletes legacy files, only `migrate` does; `setup` overwriting a
   * user's hand-edited leftover on `--force` would silently discard edits
   * that were never ported into the new `SKILL.md`.
   */
  retireLegacy?: boolean;
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
  /**
   * Set when this agent's hook install/removal threw (e.g. a shared hook
   * config file has a `hooks` key that isn't a JSON object — see
   * `readHooksObject`). This agent's whole-file artifacts (`plan` above)
   * already applied by this point regardless; only the hook step failed, and
   * later agents in the same run are unaffected — see the per-agent `try`
   * in the loop below.
   */
  error?: string;
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
  const retireLegacy = opts.retireLegacy ?? true;
  const homeDir = opts.homeDir;
  const agents = opts.agents;
  const state = await readGrounderState(homeDir);

  // Not gated on `dryRun` — a dry-run preview must refuse exactly like a real
  // run would, so the two never disagree about whether this binary can write
  // at all (see docs/architecture/state-reconciliation.md).
  assertVersionSupportsWrite(opts.grounderVersion, state);

  let runtime: ApplyAgentInstallsResult["runtime"];
  if (agents.length > 0) {
    const cliPath = runtimeCliPath(homeDir);
    // Grounder owns this directory outright (no user edits to protect), so
    // `force` isn't needed to justify a reinstall — only actual staleness is.
    const stale = await isHookRuntimeStale(homeDir);
    if (!stale) {
      runtime = { cliPath, status: "skipped", mode: await runtimeMode() };
    } else if (dryRun) {
      runtime = {
        cliPath,
        status: (await fileExists(cliPath)) ? "overwritten" : "created",
        mode: await runtimeMode(),
      };
    } else {
      runtime = await installHookRuntime({ homeDir });
    }
  }

  const results: AgentApplyResult[] = [];

  for (const agent of agents) {
    const desired = await agent.desiredArtifacts(homeDir);
    const tombstones = retireLegacy ? agent.tombstones(homeDir) : [];
    let ledgerFiles = ownedLedgerFiles(agent, ledgerFilesFor(state, agent.id), homeDir);
    if (!retireLegacy && ledgerFiles) {
      // `setup` must not retire legacy paths it already retired the ledger
      // entry for either — an empty `tombstones` list alone isn't enough:
      // `ownedLedgerFiles` still includes the legacy-commands-dir entry
      // `migrate` recorded, and reconcile() would still see it and plan a
      // delete. Restrict the ledger view itself to currently-desired paths.
      const desiredPaths = new Set(Object.keys(desired));
      ledgerFiles = Object.fromEntries(
        Object.entries(ledgerFiles).filter(([p]) => desiredPaths.has(p)),
      );
    }
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
        ownedPrefixes: agent.ownedPrefixes(homeDir),
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
    let hooksError: string | undefined;
    // Isolated per agent: a hook merge can throw on a shared config file this
    // agent doesn't own the shape of (e.g. a `hooks` key that isn't a JSON
    // object — see `readHooksObject`). Left uncaught, that unwinds past this
    // loop and skips every agent after this one, even though their installs
    // are entirely independent. `UnsupportedSchemaError` is the one exception
    // that must still abort the whole run (same contract as
    // `assertVersionSupportsWrite` above).
    try {
      if (opts.noHooks && !opts.hooks) {
        const removeHooksFn = agent.removeHooks;
        if (removeHooksFn) {
          hooksResult = await removeHooksFn({ force, dryRun, homeDir });
          if (hooksEnabled !== false) {
            hooksLedgerChanged = true;
            if (!dryRun) {
              await setHooksEnabled({
                agentId: agent.id,
                enabled: false,
                grounderVersion: opts.grounderVersion,
                homeDir,
              });
            }
          }
        }
      } else if (await shouldInstallHooks(agent, opts, hooksEnabled)) {
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
    } catch (error: unknown) {
      if (isUnsupportedSchemaError(error)) {
        throw error;
      }
      hooksError = error instanceof Error ? error.message : String(error);
    }

    const ledgerChanged = planChangesLedger(plan, ledgerFiles, desiredHashes) || hooksLedgerChanged;

    results.push({
      agent,
      plan: visiblePlan,
      hooks: hooksResult,
      ledgerChanged,
      error: hooksError,
    });
  }

  // Per-artifact writes above have no hook for an all-noop plan — stamp
  // grounderVersion unconditionally at the end of a real run so the upgrade
  // banner still clears on a fully-current machine (matches the old
  // recordAgentInstallState's every-real-run behavior). A no-op write when
  // already current.
  if (!dryRun && agents.length > 0) {
    await touchGrounderVersion(opts.grounderVersion, homeDir);
  }

  return { runtime, agents: results };
}
