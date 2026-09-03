import { type AgentAdapter, ALL_AGENTS, resolveAgents } from "../agents/index.js";
import { readHomeConfig, withHomeDir } from "../connector/home.js";
import { readGrounderState, statePath } from "../connector/state.js";
import { isUnsupportedSchemaError } from "../connector/unsupported-schema.js";
import { helpExitCode } from "../help.js";
import { VERSION } from "../index.js";
import { flagBool, flagStrings, parseArgs } from "../util/parse-args.js";
import { applyAgentInstalls } from "./apply.js";
import {
  renderModifiedNote,
  renderSummary,
  renderTable,
  rowsFromApplyResult,
  stateRow,
} from "./render-artifact-table.js";

export interface MigrateOptions {
  force?: boolean;
  hooks?: boolean;
  /** Turn hooks off (sticky — removes the fragment, flips hooksEnabled false). */
  noHooks?: boolean;
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
 * skipped with a stderr warning — same forward-compat idea as the version
 * hard stop, but migrate can still refresh the agents it understands.
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
  const hooks = flagBool(flags, "hooks");
  const noHooks = flagBool(flags, "no-hooks");
  if (hooks && noHooks) {
    process.stderr.write("Cannot pass both --hooks and --no-hooks.\n");
    return 1;
  }
  return runMigrateWithOptions({
    force: flagBool(flags, "force", "f"),
    hooks,
    noHooks,
    dryRun: flagBool(flags, "dry-run"),
    agents: agents.length > 0 ? agents : undefined,
  });
}

export async function runMigrateWithOptions(options: MigrateOptions = {}): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const homeDir = options.homeDir;
    const force = options.force ?? false;
    const hooks = options.hooks ?? false;
    const noHooks = options.noHooks ?? false;
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

    if (agents.length === 0) {
      process.stdout.write(
        "No agents recorded or detected — nothing to migrate.\n" +
          "Run `grounder setup` first, or pass --agent to target one explicitly.\n",
      );
      return 0;
    }

    if (dryRun) {
      process.stdout.write("Dry run — no files will be written.\n");
    }
    process.stdout.write("\n");

    let applyResult: Awaited<ReturnType<typeof applyAgentInstalls>>;
    try {
      applyResult = await applyAgentInstalls({
        agents,
        force,
        hooks,
        noHooks,
        refreshInstalledHooks: true,
        dryRun,
        homeDir,
        grounderVersion: VERSION,
      });
    } catch (error: unknown) {
      if (isUnsupportedSchemaError(error)) {
        process.stderr.write(`${error.message}\n`);
        return 1;
      }
      throw error;
    }

    const rows = rowsFromApplyResult(applyResult);

    // `ledgerChanged` is computed once, by the same code, whether or not this
    // is `--dry-run` — `applyAgentInstalls` decides "would this write change
    // the ledger" from the reconciled plan itself, and only actually writes
    // when it's real. So there's no separate prediction to keep in sync here:
    // real and dry-run report the exact same thing for the exact same reason.
    const ledgerChanged =
      applyResult.agents.some((a) => a.ledgerChanged) || VERSION !== state?.grounderVersion;
    rows.push(stateRow(ledgerChanged, state, statePath(homeDir)));

    renderTable(rows);
    process.stdout.write("\n");
    renderSummary(rows, dryRun);
    renderModifiedNote(rows, "grounder migrate");

    return 0;
  });
}
