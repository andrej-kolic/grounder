import { type AgentAdapter, ALL_AGENTS, resolveAgents } from "../agents/index.js";
import { readHomeConfig, withHomeDir } from "../connector/home.js";
import { assertAgentSchemasSupported, readGrounderState, statePath } from "../connector/state.js";
import { isUnsupportedSchemaError } from "../connector/unsupported-schema.js";
import { helpExitCode } from "../help.js";
import { runMigrations } from "../migrations/index.js";
import { flagBool, flagStrings, parseArgs } from "../util/parse-args.js";
import { applyAgentInstalls } from "./apply-agent-installs.js";
import {
  type Row,
  renderModifiedNote,
  renderSummary,
  renderTable,
  rowsFromApplyResult,
  stateRow,
  toLegacyRowStatus,
} from "./render-artifact-table.js";

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

    const applyResult = await applyAgentInstalls({
      agents,
      force,
      hooks,
      refreshInstalledHooks: true,
      dryRun,
      homeDir,
    });

    const migrationResults = await runMigrations({
      homeDir,
      force,
      dryRun,
      agentIds: agents.map((agent) => agent.id),
      state: await readGrounderState(homeDir),
    });

    // Grouped by agent id so each agent's legacy-retirement rows land right
    // after that same agent's own command/hook rows (see `rowsFromApplyResult`)
    // instead of every agent's rows followed by every agent's legacy rows.
    const legacyRowsByAgent = new Map<string, Row[]>();
    for (const result of migrationResults) {
      const rowStatus = toLegacyRowStatus(result.status);
      if (rowStatus) {
        const row: Row = {
          status: rowStatus,
          target: result.agentId,
          path: result.path,
          forceAction: result.status === "left-modified" ? "delete" : undefined,
        };
        const existing = legacyRowsByAgent.get(result.agentId);
        if (existing) {
          existing.push(row);
        } else {
          legacyRowsByAgent.set(result.agentId, [row]);
        }
      }
    }

    const rows: Row[] = rowsFromApplyResult(
      applyResult,
      (agentId) => legacyRowsByAgent.get(agentId) ?? [],
    );

    // `ledgerChanged` is computed once, by the same code, whether or not this
    // is `--dry-run` — `applyAgentInstalls`/`recordAgentInstallState` and
    // `004-retire-legacy-commands` each decide "would this write change the
    // ledger" via `wouldChangeGrounderState` up front, and only actually
    // write when it's real *and* the answer was yes. So there's no separate
    // prediction to keep in sync here: real and dry-run report the exact same
    // thing for the exact same reason.
    const ledgerChanged =
      applyResult.agents.some((a) => a.ledgerChanged) ||
      migrationResults.some((r) => r.ledgerChanged);
    // `stateRow` is driven entirely by `ledgerChanged` — `state` only picks
    // the word ("create" vs "update"), it can't force a change that isn't
    // there. In practice `!state && agents.length > 0` always yields
    // `ledgerChanged` (any write against a missing ledger changes it), but
    // this stays correct even if a future adapter path could reach here
    // without writing.
    rows.push(stateRow(ledgerChanged, state, statePath(homeDir)));

    renderTable(rows);
    process.stdout.write("\n");
    renderSummary(rows, dryRun);
    renderModifiedNote(rows, "grounder migrate");

    return 0;
  });
}
