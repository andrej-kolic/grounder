import { type AgentAdapter, ALL_AGENTS, resolveAgents } from "../agents/index.js";
import { readHomeConfig, withHomeDir } from "../connector/home.js";
import { assertAgentSchemasSupported, readGrounderState, statePath } from "../connector/state.js";
import { isUnsupportedSchemaError } from "../connector/unsupported-schema.js";
import { helpExitCode } from "../help.js";
import { runMigrations } from "../migrations/index.js";
import { flagBool, flagStrings, parseArgs } from "../util/parse-args.js";
import { applyAgentInstalls, shouldInstallHooks } from "./apply-agent-installs.js";

export interface MigrateOptions {
  force?: boolean;
  hooks?: boolean;
  dryRun?: boolean;
  homeDir?: string;
  /** Agent ids to migrate. Defaults to ledger keys, else auto-detect. */
  agents?: string[];
}

/**
 * Resolve which agents to migrate:
 * 1. Explicit `--agent` ids (unknown ids still throw)
 * 2. Else agents recorded in `~/.grounder/state.json` that this binary knows
 * 3. Else auto-detect installed agents (legacy / pre-ledger)
 *
 * Ledger keys from a newer Grounder (agents this binary does not know) are
 * skipped with a stderr warning — same forward-compat idea as schema hard-stops,
 * but migrate can still refresh the agents it understands.
 */
export async function resolveMigrateAgents(
  explicitIds: string[] | undefined,
  homeDir?: string,
): Promise<AgentAdapter[]> {
  if (explicitIds && explicitIds.length > 0) {
    return resolveAgents(explicitIds);
  }

  const state = await readGrounderState(homeDir);
  const recordedIds = state ? Object.keys(state.agents) : [];
  if (recordedIds.length === 0) {
    return resolveAgents();
  }

  const known = ALL_AGENTS.filter((a) => recordedIds.includes(a.id));
  const unknown = recordedIds.filter((id) => !ALL_AGENTS.some((a) => a.id === id));
  if (unknown.length > 0) {
    process.stderr.write(
      `Skipping unknown agent(s) in install state: ${unknown.join(", ")}. Upgrade grounder to migrate them.\n`,
    );
  }
  return known;
}

export async function runMigrate(argv: string[]): Promise<number> {
  const helpCode = helpExitCode(argv, "migrate");
  if (helpCode !== null) {
    return helpCode;
  }

  const { flags, repeated } = parseArgs(argv);
  const agents = flagStrings(repeated, "agent");
  return runMigrateWithOptions({
    force: flagBool(flags, "force", "f"),
    hooks: flagBool(flags, "hooks"),
    dryRun: flagBool(flags, "dry-run"),
    agents: agents.length > 0 ? agents : undefined,
  });
}

export async function runMigrateWithOptions(options: MigrateOptions = {}): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const homeDir = options.homeDir;
    const force = options.force ?? false;
    const hooks = options.hooks ?? false;
    const dryRun = options.dryRun ?? false;

    const home = await readHomeConfig();
    if (!home) {
      process.stderr.write("No home config found. Run `grounder setup <path>` first.\n");
      return 1;
    }

    const agents = await resolveMigrateAgents(options.agents, homeDir);

    let state: Awaited<ReturnType<typeof readGrounderState>>;
    try {
      state = await readGrounderState(homeDir);
      assertAgentSchemasSupported(state, agents);
    } catch (error: unknown) {
      if (isUnsupportedSchemaError(error)) {
        process.stderr.write(`${error.message}\n`);
        return 1;
      }
      throw error;
    }

    process.stdout.write(`Vault root: ${home.vaultRoot}\n`);
    process.stdout.write(
      "Refresh Grounder after an upgrade (slash commands/hooks; vault path unchanged).\n",
    );
    process.stdout.write(dryRun ? "Would refresh:\n" : "Will refresh:\n");
    if (agents.length === 0) {
      process.stdout.write("  (no agents recorded or detected)\n");
    } else {
      for (const agent of agents) {
        for (const artifactPath of agent.expectedArtifacts(homeDir)) {
          process.stdout.write(`  ${agent.id.padEnd(8)} ${artifactPath}\n`);
        }
      }
      let anyHooks = false;
      for (const agent of agents) {
        if (!agent.expectedHookArtifacts) {
          continue;
        }
        if (
          !(await shouldInstallHooks(agent, { hooks, refreshInstalledHooks: true, homeDir }, state))
        ) {
          continue;
        }
        anyHooks = true;
        for (const hookPath of agent.expectedHookArtifacts(homeDir)) {
          process.stdout.write(`  ${agent.id.padEnd(8)} ${hookPath}\n`);
        }
      }
      if (!anyHooks) {
        process.stdout.write("  hooks    none previously installed (pass --hooks to install)\n");
      }
      process.stdout.write(`  state    ${statePath(homeDir)}\n`);
    }
    process.stdout.write("\n");

    if (agents.length === 0) {
      process.stdout.write("Nothing to migrate.\n");
      return 0;
    }

    await applyAgentInstalls({
      agents,
      force,
      hooks,
      refreshInstalledHooks: true,
      dryRun,
      homeDir,
    });

    const stateForMigrations = await readGrounderState(homeDir);
    const migrationResults = await runMigrations({
      homeDir,
      force,
      dryRun,
      agentIds: agents.map((agent) => agent.id),
      state: stateForMigrations,
    });
    for (const result of migrationResults) {
      if (result.status !== "retired") {
        continue;
      }
      process.stdout.write(
        `✓ ${dryRun ? "Would delete" : "Deleted"} old command file: ${result.path}\n`,
      );
    }

    // Same outcome whether this is a dry run or not — the file is untouched
    // either way without --force — so there's nothing to phrase differently.
    const leftModified = migrationResults.filter((r) => r.status === "left-modified");
    if (leftModified.length > 0) {
      const noun = leftModified.length === 1 ? "file" : "files";
      process.stdout.write(
        `\n${leftModified.length} old command ${noun} left in place — Grounder can't confirm ` +
          "they're unedited:\n",
      );
      for (const result of leftModified) {
        process.stdout.write(`  ${result.path}\n`);
      }
      process.stdout.write(
        "These can show up as a duplicate /grounder-* entry in your command menu.\n" +
          "Run 'grounder migrate --force' to delete them (any edits are lost).\n",
      );
    }

    return 0;
  });
}
