import { type AgentAdapter, ALL_AGENTS, resolveAgents } from "../agents/index.js";
import type { ArtifactStatus } from "../agents/types.js";
import { readHomeConfig, withHomeDir } from "../connector/home.js";
import { assertAgentSchemasSupported, readGrounderState, statePath } from "../connector/state.js";
import { isUnsupportedSchemaError } from "../connector/unsupported-schema.js";
import { helpExitCode } from "../help.js";
import { runMigrations } from "../migrations/index.js";
import type { LegacyRetireStatus } from "../migrations/types.js";
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

/** A row's plan status, independent of tense — "current" never changes wording; the
 * others are rendered as an infinitive in a dry run and past tense in a real one. */
type RowStatus = "current" | "create" | "update" | "delete" | "modified";

interface Row {
  status: RowStatus;
  agent: string;
  path: string;
}

function toRowStatus(status: ArtifactStatus): RowStatus {
  switch (status) {
    case "skipped":
      return "current";
    case "created":
      return "create";
    case "overwritten":
      return "update";
    case "modified":
      return "modified";
  }
}

function toLegacyRowStatus(status: LegacyRetireStatus): RowStatus | undefined {
  switch (status) {
    case "retired":
      return "delete";
    case "left-modified":
      return "modified";
    case "already-absent":
      return undefined;
  }
}

const VERB: Record<RowStatus, { dry: string; real: string }> = {
  current: { dry: "current", real: "current" },
  create: { dry: "create", real: "created" },
  update: { dry: "update", real: "updated" },
  delete: { dry: "delete", real: "deleted" },
  modified: { dry: "modified", real: "modified" },
};

/**
 * Table cell label per status — the same word in dry-run and real, so the
 * table asserts one outcome vocabulary instead of reconjugating per row
 * (matching `kubectl apply`'s created/configured/unchanged). Dry-run-ness is
 * already announced once above the table and in the summary sentence, which
 * keeps its own tense (`VERB` above) since "would create" is a sentence
 * construction, not a table cell.
 *
 * `modified` is deliberately not "modified" here: under an ACTION column
 * that reads as Grounder having modified the file, when the row means the
 * opposite — a local edit was found and Grounder left it untouched. "conflict"
 * names that outcome without implying an action was taken.
 */
const TABLE_LABEL: Record<RowStatus, string> = {
  current: "unchanged",
  create: "created",
  update: "updated",
  delete: "deleted",
  modified: "conflict",
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function renderTable(rows: Row[]): void {
  const statusWidth =
    Math.max("ACTION".length, ...rows.map((r) => TABLE_LABEL[r.status].length)) + 1;
  const agentWidth = Math.max("TARGET".length, ...rows.map((r) => r.agent.length)) + 1;
  process.stdout.write(`${"ACTION".padEnd(statusWidth)}${"TARGET".padEnd(agentWidth)}PATH\n`);
  for (const row of rows) {
    const verb = TABLE_LABEL[row.status];
    process.stdout.write(`${verb.padEnd(statusWidth)}${row.agent.padEnd(agentWidth)}${row.path}\n`);
  }
}

function renderSummary(rows: Row[], dryRun: boolean): void {
  const counts: Record<RowStatus, number> = {
    current: 0,
    create: 0,
    update: 0,
    delete: 0,
    modified: 0,
  };
  for (const row of rows) {
    counts[row.status]++;
  }

  const acted: string[] = [];
  for (const status of ["create", "update", "delete"] as const) {
    if (counts[status] > 0) {
      acted.push(`${VERB[status][dryRun ? "dry" : "real"]} ${counts[status]}`);
    }
  }

  if (acted.length === 0) {
    process.stdout.write(
      counts.current > 0
        ? `Nothing to do — ${plural(counts.current, "file")} unchanged.\n`
        : "Nothing to do.\n",
    );
    return;
  }

  let line: string;
  if (dryRun) {
    line = `Would ${acted.join(", ")}`;
    if (counts.current > 0) {
      line += `, leave ${plural(counts.current, "file")} unchanged`;
    }
    line += ". Run without --dry-run to apply.";
  } else {
    line = acted.join(", ");
    if (counts.current > 0) {
      line += `, ${plural(counts.current, "file")} unchanged`;
    }
    line += ".";
    line = line[0]?.toUpperCase() + line.slice(1);
  }
  process.stdout.write(`${line}\n`);
}

function renderModifiedNote(rows: Row[]): void {
  const modified = rows.filter((r) => r.status === "modified");
  if (modified.length === 0) {
    return;
  }
  process.stdout.write(
    `\n${plural(modified.length, "file")} left alone — Grounder can't confirm ${
      modified.length === 1 ? "it's" : "they're"
    } unedited:\n`,
  );
  for (const row of modified) {
    process.stdout.write(`  ${row.path}\n`);
  }
  process.stdout.write(
    `Run 'grounder migrate --force' to overwrite ${
      modified.length === 1 ? "it" : "them"
    } (any local edits are lost).\n`,
  );
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
      quiet: true,
    });

    const migrationResults = await runMigrations({
      homeDir,
      force,
      dryRun,
      agentIds: agents.map((agent) => agent.id),
      state: await readGrounderState(homeDir),
    });

    const rows: Row[] = [];
    if (applyResult.runtime) {
      rows.push({
        status: toRowStatus(applyResult.runtime.status),
        agent: "runtime",
        path: applyResult.runtime.cliPath,
      });
    }
    for (const agentResult of applyResult.agents) {
      for (const [path, status] of Object.entries(agentResult.commands.artifacts)) {
        rows.push({ status: toRowStatus(status), agent: agentResult.agent.id, path });
      }
      if (agentResult.hooks) {
        for (const [path, status] of Object.entries(agentResult.hooks.artifacts)) {
          rows.push({ status: toRowStatus(status), agent: agentResult.agent.id, path });
        }
      }
      for (const result of migrationResults) {
        if (result.agentId !== agentResult.agent.id) {
          continue;
        }
        const rowStatus = toLegacyRowStatus(result.status);
        if (rowStatus) {
          rows.push({ status: rowStatus, agent: agentResult.agent.id, path: result.path });
        }
      }
    }
    rows.push({
      status: state ? "update" : "create",
      agent: "state",
      path: statePath(homeDir),
    });

    renderTable(rows);
    process.stdout.write("\n");
    renderSummary(rows, dryRun);
    renderModifiedNote(rows);

    return 0;
  });
}
