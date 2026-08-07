import type { AgentAdapter } from "../agents/index.js";
import { resolveAgents } from "../agents/index.js";
import { readHomeConfig, withHomeDir } from "../connector/home.js";
import { readGrounderState } from "../connector/state.js";
import { flagBool, flagStrings, parseArgs } from "../util/parse-args.js";
import { applyAgentInstalls } from "./apply-agent-installs.js";

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
 * 1. Explicit `--agent` ids
 * 2. Else agents recorded in `~/.grounder/state.json`
 * 3. Else auto-detect installed agents (legacy / pre-ledger)
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
  if (recordedIds.length > 0) {
    return resolveAgents(recordedIds);
  }

  return resolveAgents();
}

export async function runMigrate(argv: string[]): Promise<number> {
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
      process.stderr.write("No home config found. Run `grounder vault init <path>` first.\n");
      return 1;
    }

    const agents = await resolveMigrateAgents(options.agents, homeDir);

    process.stdout.write(`Vault root: ${home.vaultRoot}\n`);
    if (dryRun) {
      process.stdout.write("Dry run — no files will be written.\n");
    }
    process.stdout.write("Will refresh:\n");
    if (agents.length === 0) {
      process.stdout.write("  (no agents recorded or detected)\n");
    } else {
      for (const agent of agents) {
        for (const artifactPath of agent.expectedArtifacts(homeDir)) {
          process.stdout.write(`  ${agent.id.padEnd(8)} ${artifactPath}\n`);
        }
      }
      process.stdout.write(
        "  hooks    previously installed or --hooks (owned JSON always refreshed)\n",
      );
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

    return 0;
  });
}
