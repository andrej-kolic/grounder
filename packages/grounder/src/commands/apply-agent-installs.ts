import {
  hookFileHasGrounderEntry,
  installHookRuntime,
  runtimeCliPath,
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

export interface ApplyAgentInstallsOptions {
  agents: AgentAdapter[];
  force?: boolean;
  /** Explicitly install/refresh session hooks (vault init --hooks / migrate --hooks). */
  hooks?: boolean;
  /**
   * When true (migrate), also refresh hooks that were previously recorded or
   * already present on disk — without installing hooks for agents that never
   * opted in.
   */
  refreshInstalledHooks?: boolean;
  dryRun?: boolean;
  homeDir?: string;
}

export interface AgentApplyResult {
  agent: AgentAdapter;
  commands: AgentInstallResult;
  hooks?: AgentInstallResult;
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
  opts: ApplyAgentInstallsOptions,
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

function commandLabel(status: ArtifactStatus, artifactPath: string, dryRun: boolean): string {
  switch (status) {
    case "skipped":
      return dryRun ? "would skip (already current)" : "already current (skipped)";
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

function hookLabel(status: ArtifactStatus, artifactPath: string, dryRun: boolean): string {
  switch (status) {
    case "skipped":
      return dryRun ? "would skip (already current)" : "already exists (skipped)";
    case "created":
      return dryRun ? `would install: ${artifactPath}` : `installed: ${artifactPath}`;
    case "overwritten":
      return dryRun ? `would update: ${artifactPath}` : `updated: ${artifactPath}`;
    case "modified":
      return dryRun ? `would skip: ${artifactPath}` : `skipped: ${artifactPath}`;
  }
}

/**
 * Materialize runtime + install/refresh agent command (and optional hook)
 * artifacts. Shared by `grounder vault init` and `grounder migrate`.
 */
export async function applyAgentInstalls(
  opts: ApplyAgentInstallsOptions,
): Promise<ApplyAgentInstallsResult> {
  const force = opts.force ?? false;
  const dryRun = opts.dryRun ?? false;
  const homeDir = opts.homeDir;
  const agents = opts.agents;
  const state = await readGrounderState(homeDir);
  assertAgentSchemasSupported(state, agents);

  let runtime: ApplyAgentInstallsResult["runtime"];
  if (agents.length > 0) {
    if (dryRun) {
      process.stdout.write(`✓ Grounder runtime would refresh: ${runtimeCliPath(homeDir)}\n`);
    } else {
      runtime = await installHookRuntime({ homeDir });
      const runtimeLabel =
        runtime.status === "skipped"
          ? "already exists (skipped)"
          : `installed (${runtime.mode}): ${runtime.cliPath}`;
      process.stdout.write(`✓ Grounder runtime ${runtimeLabel}\n`);
    }
  }

  const results: AgentApplyResult[] = [];

  for (const agent of agents) {
    const commands = await agent.install({ force, dryRun, homeDir });
    for (const [artifactPath, status] of Object.entries(commands.artifacts)) {
      process.stdout.write(
        `✓ ${agent.name} command ${commandLabel(status, artifactPath, dryRun)}\n`,
      );
    }
    if (Object.keys(commands.artifacts).length === 0) {
      process.stdout.write(`✓ ${agent.name}: no artifacts to install yet\n`);
    }

    let hooksResult: AgentInstallResult | undefined;
    let hooksInstalled = false;
    if (await shouldInstallHooks(agent, opts, state)) {
      const installHooks = agent.installHooks;
      if (installHooks) {
        hooksResult = await installHooks({ force, dryRun, homeDir });
        hooksInstalled = true;
        for (const [artifactPath, status] of Object.entries(hooksResult.artifacts)) {
          process.stdout.write(`✓ ${agent.name} hook ${hookLabel(status, artifactPath, dryRun)}\n`);
        }
      }
    }

    if (!dryRun) {
      const statuses = Object.values(commands.artifacts);
      // Only bump the commands version in state when at least one file was
      // written or already up to date. If every file was skipped as locally
      // edited (or from before Grounder tracked hashes), do not mark state as
      // current — otherwise plain migrate would silence doctor while leaving
      // those old command files untouched.
      const advanceCommandsSchema =
        statuses.length === 0 || statuses.some((status) => status !== "modified");
      await recordAgentInstallState(agent, {
        hooksInstalled,
        homeDir,
        advanceCommandsSchema,
      });
    }

    results.push({ agent, commands, hooks: hooksResult });
  }

  if (agents.length > 0) {
    const ledger = statePath(homeDir);
    if (dryRun) {
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

  const modifiedWithoutForce =
    !force &&
    results.some((r) => Object.values(r.commands.artifacts).some((s) => s === "modified"));
  if (modifiedWithoutForce) {
    process.stdout.write(
      "\nNote: some command files were left alone (local edits, or an install from before Grounder 0.3).\n" +
        "  To refresh them: grounder migrate --force\n",
    );
  }

  return { runtime, agents: results };
}
