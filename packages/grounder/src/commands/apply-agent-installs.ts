import {
  hookFileHasGrounderEntry,
  installHookRuntime,
  isHookRuntimeStale,
  runtimeCliPath,
  runtimeMode,
} from "../agents/hook-runtime.js";
import { recordAgentInstallState } from "../agents/index.js";
import type { AgentAdapter, AgentInstallResult, ArtifactStatus } from "../agents/types.js";
import {
  assertAgentSchemasSupported,
  type GrounderState,
  readGrounderState,
  recordedHooksSchema,
  statePath,
} from "../connector/state.js";
import { fileExists } from "../util/fs.js";

export interface ApplyAgentInstallsOptions {
  agents: AgentAdapter[];
  force?: boolean;
  /** Explicitly install/refresh session hooks (setup --hooks / migrate --hooks). */
  hooks?: boolean;
  /**
   * When true (migrate), also refresh hooks that were previously recorded or
   * already present on disk — without installing hooks for agents that never
   * opted in.
   */
  refreshInstalledHooks?: boolean;
  dryRun?: boolean;
  homeDir?: string;
  /** Suppress all stdout reporting — caller renders the returned result itself. */
  quiet?: boolean;
}

export interface AgentApplyResult {
  agent: AgentAdapter;
  commands: AgentInstallResult;
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

async function shouldInstallHooks(
  agent: AgentAdapter,
  opts: Pick<ApplyAgentInstallsOptions, "hooks" | "refreshInstalledHooks" | "homeDir">,
  state: GrounderState | null,
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
  if (recordedHooksSchema(state, agent.id) > 0) {
    return true;
  }
  return agentHasInstalledHooks(agent, opts.homeDir);
}

type ChangedStatus = Exclude<ArtifactStatus, "skipped">;

function commandLabel(status: ChangedStatus, artifactPath: string, dryRun: boolean): string {
  switch (status) {
    case "modified":
      return dryRun
        ? `would skip locally modified (needs --force): ${artifactPath}`
        : `locally modified (skipped — use --force): ${artifactPath}`;
    case "created":
      return dryRun ? `would install: ${artifactPath}` : `installed: ${artifactPath}`;
    case "overwritten":
      return dryRun ? `would update: ${artifactPath}` : `updated: ${artifactPath}`;
  }
}

function hookLabel(status: ChangedStatus, artifactPath: string, dryRun: boolean): string {
  switch (status) {
    case "created":
      return dryRun ? `would install: ${artifactPath}` : `installed: ${artifactPath}`;
    case "overwritten":
      return dryRun ? `would update: ${artifactPath}` : `updated: ${artifactPath}`;
    case "modified":
      return dryRun ? `would skip: ${artifactPath}` : `skipped: ${artifactPath}`;
  }
}

/**
 * Print one line per skill/hook file that actually changed (or would), plus
 * a single collapsed count for everything already current — not one
 * identical, path-less line per current file. That per-file "skipped" line
 * used to carry no path at all, so 5 up-to-date files produced 5 indistinguishable
 * lines with no information in any of them.
 */
function printArtifactResults(
  agentName: string,
  kind: "skill" | "hook",
  result: AgentInstallResult,
  dryRun: boolean,
): void {
  const entries = Object.entries(result.artifacts);
  if (entries.length === 0) {
    if (kind === "skill") {
      process.stdout.write(`✓ ${agentName}: no artifacts to install yet\n`);
    }
    return;
  }

  const label = kind === "skill" ? commandLabel : hookLabel;
  let currentCount = 0;
  for (const [artifactPath, status] of entries) {
    if (status === "skipped") {
      currentCount++;
      continue;
    }
    process.stdout.write(`✓ ${agentName} ${kind} ${label(status, artifactPath, dryRun)}\n`);
  }
  if (currentCount > 0) {
    const noun = currentCount === 1 ? "file" : "files";
    process.stdout.write(`✓ ${agentName}: ${currentCount} ${kind} ${noun} already current\n`);
  }
}

/**
 * Materialize runtime + install/refresh agent command (and optional hook)
 * artifacts. Shared by `grounder setup` and `grounder migrate`.
 */
export async function applyAgentInstalls(
  opts: ApplyAgentInstallsOptions,
): Promise<ApplyAgentInstallsResult> {
  const force = opts.force ?? false;
  const dryRun = opts.dryRun ?? false;
  const quiet = opts.quiet ?? false;
  const homeDir = opts.homeDir;
  const agents = opts.agents;
  const state = await readGrounderState(homeDir);
  assertAgentSchemasSupported(state, agents);

  let runtime: ApplyAgentInstallsResult["runtime"];
  if (agents.length > 0) {
    const cliPath = runtimeCliPath(homeDir);
    // Grounder owns this directory outright (no user edits to protect), so
    // `force` isn't needed to justify a reinstall — only actual staleness is.
    // Gating here (rather than always reinstalling) is what lets a fully
    // current machine report the runtime row as unchanged instead of
    // "overwritten" on every single `migrate`.
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
    if (!quiet) {
      const verb = dryRun ? "would refresh" : "installed";
      const runtimeLabel =
        runtime.status === "skipped"
          ? "already exists (skipped)"
          : `${verb} (${runtime.mode}): ${runtime.cliPath}`;
      process.stdout.write(`✓ Grounder runtime ${runtimeLabel}\n`);
    }
  }

  const results: AgentApplyResult[] = [];

  for (const agent of agents) {
    const commands = await agent.install({ force, dryRun, homeDir });
    if (!quiet) {
      printArtifactResults(agent.name, "skill", commands, dryRun);
    }

    let hooksResult: AgentInstallResult | undefined;
    let hooksInstalled = false;
    if (await shouldInstallHooks(agent, opts, state)) {
      const installHooks = agent.installHooks;
      if (installHooks) {
        hooksResult = await installHooks({ force, dryRun, homeDir });
        hooksInstalled = true;
        if (!quiet) {
          printArtifactResults(agent.name, "hook", hooksResult, dryRun);
        }
      }
    }

    const statuses = Object.values(commands.artifacts);
    // Only bump the commands version in state when at least one file was
    // written or already up to date. If every file was skipped as locally
    // edited (or from before Grounder tracked hashes), do not mark state as
    // current — otherwise plain migrate would silence doctor while leaving
    // those skill files untouched.
    const advanceCommandsSchema =
      statuses.length === 0 || statuses.some((status) => status !== "modified");
    // Called unconditionally (dry or real) — the same predicate that decides
    // whether to write also answers "would this change the ledger", so a
    // `--dry-run` preview can't disagree with what a real run would report.
    const stateChanged = await recordAgentInstallState(agent, {
      hooksInstalled,
      homeDir,
      advanceCommandsSchema,
      dryRun,
    });

    results.push({
      agent,
      commands,
      hooks: hooksResult,
      ledgerChanged: (commands.ledgerChanged ?? false) || stateChanged,
    });
  }

  const ledgerChanged = results.some((r) => r.ledgerChanged);
  if (agents.length > 0 && !quiet) {
    const ledger = statePath(homeDir);
    if (!ledgerChanged) {
      process.stdout.write(`✓ Install state already up to date: ${ledger}\n`);
    } else if (dryRun) {
      process.stdout.write(
        state
          ? `✓ Install state would update: ${ledger}\n`
          : `✓ Install state would create: ${ledger}\n`,
      );
    } else {
      process.stdout.write(
        state ? `✓ Install state updated: ${ledger}\n` : `✓ Install state created: ${ledger}\n`,
      );
    }
  }

  if (!quiet) {
    const modifiedWithoutForce =
      !force &&
      results.some((r) => Object.values(r.commands.artifacts).some((s) => s === "modified"));
    if (modifiedWithoutForce) {
      process.stdout.write(
        "\nNote: some skill files were left alone (local edits, or an install from before Grounder 0.3).\n" +
          "  To refresh them: grounder migrate --force\n",
      );
    }
  }

  return { runtime, agents: results };
}
