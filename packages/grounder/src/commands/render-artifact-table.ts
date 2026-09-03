import type { ArtifactStatus } from "../agents/types.js";
import type { GrounderState } from "../connector/state.js";
import type { LegacyRetireStatus } from "../migrations/types.js";
import type { ApplyAgentInstallsResult } from "./apply-agent-installs.js";

/** A row's plan status, independent of tense — "current" never changes wording; the
 * others are rendered as an infinitive in a dry run and past tense in a real one. */
export type RowStatus = "current" | "create" | "update" | "delete" | "modified";

export interface Row {
  status: RowStatus;
  target: string;
  path: string;
  /** Only meaningful when `status === "modified"` — what `--force` would do to this path. */
  forceAction?: "overwrite" | "delete";
}

export function toRowStatus(status: ArtifactStatus): RowStatus {
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

export function toLegacyRowStatus(status: LegacyRetireStatus): RowStatus | undefined {
  switch (status) {
    case "retired":
      return "delete";
    case "left-modified":
      return "modified";
    case "already-absent":
      return undefined;
  }
}

export const VERB: Record<RowStatus, { dry: string; real: string }> = {
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
 * `modified` is deliberately not "modified" here: that word would read as
 * Grounder having modified the file, when the row means the opposite — a
 * local edit was found and Grounder left it untouched. "conflict" names that
 * outcome without implying an action was taken (see the STATUS header below,
 * not ACTION, for the same reason).
 */
export const TABLE_LABEL: Record<RowStatus, string> = {
  current: "unchanged",
  create: "created",
  update: "updated",
  delete: "deleted",
  modified: "conflict",
};

/**
 * Runtime + per-agent command/hook rows shared by `setup` and `migrate` —
 * both callers add the trailing state/ledger row on top since that isn't
 * part of `applyAgentInstalls`'s result.
 *
 * @param extraRowsForAgent Rows to splice in right after one agent's own
 * command/hook rows, keyed by agent id — e.g. migrate's legacy-retirement
 * rows, so a two-agent run reads as one block per agent (cursor rows, cursor
 * legacy deletes, claude rows, claude legacy deletes) instead of every
 * agent's rows followed by every agent's legacy rows.
 */
export function rowsFromApplyResult(
  applyResult: ApplyAgentInstallsResult,
  extraRowsForAgent?: (agentId: string) => Row[],
): Row[] {
  const rows: Row[] = [];
  if (applyResult.runtime) {
    rows.push({
      status: toRowStatus(applyResult.runtime.status),
      target: "runtime",
      path: applyResult.runtime.cliPath,
    });
  }
  for (const agentResult of applyResult.agents) {
    for (const [path, status] of Object.entries(agentResult.commands.artifacts)) {
      rows.push({
        status: toRowStatus(status),
        target: agentResult.agent.id,
        path,
        forceAction: status === "modified" ? "overwrite" : undefined,
      });
    }
    if (agentResult.hooks) {
      for (const [path, status] of Object.entries(agentResult.hooks.artifacts)) {
        rows.push({
          status: toRowStatus(status),
          // Distinguishes a hook artifact from that agent's command/skill
          // rows above — echoing (not textually identical to) the "hook
          // <path>" wording setup's pre-confirm preview list already uses.
          target: `${agentResult.agent.id} hook`,
          path,
          forceAction: status === "modified" ? "overwrite" : undefined,
        });
      }
    }
    if (extraRowsForAgent) {
      rows.push(...extraRowsForAgent(agentResult.agent.id));
    }
  }
  return rows;
}

/**
 * The trailing `state` row both `setup` and `migrate` append — same
 * create/update/current rule either way, so the two callers can't drift on
 * how a ledger write is reported. `ledgerChanged` is each caller's own
 * computation (migrate also folds in legacy-retirement writes); this only
 * owns turning that bit plus prior-state nullness into a `Row`.
 */
export function stateRow(
  ledgerChanged: boolean,
  priorState: GrounderState | null,
  path: string,
): Row {
  const status: RowStatus = !ledgerChanged ? "current" : !priorState ? "create" : "update";
  return { status, target: "state", path };
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function renderTable(rows: Row[]): void {
  const statusWidth =
    Math.max("STATUS".length, ...rows.map((r) => TABLE_LABEL[r.status].length)) + 1;
  const targetWidth = Math.max("TARGET".length, ...rows.map((r) => r.target.length)) + 1;
  process.stdout.write(`${"STATUS".padEnd(statusWidth)}${"TARGET".padEnd(targetWidth)}PATH\n`);
  for (const row of rows) {
    const verb = TABLE_LABEL[row.status];
    process.stdout.write(
      `${verb.padEnd(statusWidth)}${row.target.padEnd(targetWidth)}${row.path}\n`,
    );
  }
}

export function renderSummary(rows: Row[], dryRun: boolean): void {
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

  if (acted.length === 0 && counts.modified === 0) {
    process.stdout.write(
      counts.current > 0
        ? `Nothing to do — ${plural(counts.current, "file")} unchanged.\n`
        : "Nothing to do.\n",
    );
    return;
  }

  // Conflicts get their own trailer here (in addition to the per-file detail
  // in `renderModifiedNote`) so a run whose only pending work is a left-alone
  // conflict never reports "Nothing to do" — see the `acted.length === 0`
  // check above, which now only fires when there's truly nothing pending.
  const trailers: string[] = [];
  if (counts.current > 0) {
    trailers.push(`${plural(counts.current, "file")} unchanged`);
  }
  if (counts.modified > 0) {
    trailers.push(
      `${plural(counts.modified, "file")} left as ${counts.modified === 1 ? "a conflict" : "conflicts"}`,
    );
  }

  let line: string;
  if (dryRun) {
    line = acted.length > 0 ? `Would ${acted.join(", ")}` : "Nothing to write";
    for (const trailer of trailers) {
      line += `, ${trailer}`;
    }
    line +=
      acted.length > 0 ? ". Run without --dry-run to apply." : ". Run with --force to resolve.";
  } else {
    line = acted.join(", ");
    for (const trailer of trailers) {
      line += line ? `, ${trailer}` : trailer;
    }
    line += ".";
    line = (line[0]?.toUpperCase() ?? "") + line.slice(1);
  }
  process.stdout.write(`${line}\n`);
}

/**
 * @param forceCommand The command line (without `--force`) the reader should
 * re-run to resolve conflicts. Both `setup` and `migrate` pass `"grounder
 * migrate"` today — `setup --force` applies just as well, but pointing every
 * conflict at one canonical command keeps the remediation message the same
 * regardless of which command surfaced the conflict.
 */
export function renderModifiedNote(rows: Row[], forceCommand: string): void {
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
    const action = row.forceAction === "delete" ? "would be deleted" : "would be overwritten";
    process.stdout.write(`  ${row.path} (${action})\n`);
  }
  const hasOverwrite = modified.some((r) => r.forceAction !== "delete");
  const hasDelete = modified.some((r) => r.forceAction === "delete");
  const verb =
    hasOverwrite && hasDelete ? "overwrite or delete" : hasDelete ? "delete" : "overwrite";
  process.stdout.write(
    `Run '${forceCommand} --force' to ${verb} ${
      modified.length === 1 ? "it" : "them"
    } (any local edits are lost).\n`,
  );
}
