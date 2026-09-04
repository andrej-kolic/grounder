import type { ArtifactStatus } from "../agents/types.js";
import type { GrounderState } from "../connector/state.js";
import type { PlanAction, PlanEntry } from "../reconcile/core.js";
import type { ApplyAgentInstallsResult } from "./apply.js";

/** A row's plan status, independent of tense — "current" never changes wording; the
 * others are rendered as an infinitive in a dry run and past tense in a real one. */
export type RowStatus = "current" | "create" | "update" | "delete" | "forget" | "modified";

export interface Row {
  status: RowStatus;
  target: string;
  path: string;
  /** Only meaningful when `status === "modified"` — what `--force` would do to this path. */
  forceAction?: "overwrite" | "delete";
}

/** For hook/runtime rows, still reported via the old imperative `ArtifactStatus` shape. */
export function toRowStatus(status: ArtifactStatus): RowStatus {
  switch (status) {
    case "skipped":
      return "current";
    case "created":
      return "create";
    case "overwritten":
      return "update";
  }
}

/**
 * Whole-file artifact rows come straight from the reconciler's own plan
 * vocabulary. `forget` gets its own status, distinct from `noop`'s
 * "current" — a forget entry always changes `state.json` (see
 * `planChangesLedger`), even though it never touches the file itself, so
 * folding it into "current"/"unchanged" would hide the one row that explains
 * why the trailing state row says "updated".
 */
export function rowStatusFromPlanAction(action: PlanAction): RowStatus {
  switch (action) {
    case "noop":
      return "current";
    case "forget":
      return "forget";
    case "create":
      return "create";
    case "update":
      return "update";
    case "delete":
      return "delete";
    case "conflict":
      return "modified";
  }
}

export function rowFromPlanEntry(target: string, entry: PlanEntry): Row {
  return {
    status: rowStatusFromPlanAction(entry.action),
    target,
    path: entry.path,
    forceAction: entry.blockedAction,
  };
}

export const VERB: Record<RowStatus, { dry: string; real: string }> = {
  current: { dry: "current", real: "current" },
  create: { dry: "create", real: "created" },
  update: { dry: "update", real: "updated" },
  delete: { dry: "delete", real: "deleted" },
  forget: { dry: "forget", real: "forgotten" },
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
 *
 * `forget` is deliberately not "unchanged" here, even though the file itself
 * is untouched: the ledger entry for it is dropped, which is exactly the
 * "updated" the trailing state row reports — collapsing it into "unchanged"
 * would leave that state-row change unexplained by any visible row.
 */
export const TABLE_LABEL: Record<RowStatus, string> = {
  current: "unchanged",
  create: "created",
  update: "updated",
  delete: "deleted",
  forget: "forgotten",
  modified: "conflict",
};

/**
 * Runtime + per-agent whole-file/hook rows shared by `setup` and `migrate` —
 * both callers add the trailing state/ledger row on top since that isn't
 * part of `applyAgentInstalls`'s result. Tombstone retirement is already
 * folded into each agent's own `plan`, so it lands right after that agent's
 * own artifact rows with no separate grouping step needed.
 */
export function rowsFromApplyResult(applyResult: ApplyAgentInstallsResult): Row[] {
  const rows: Row[] = [];
  if (applyResult.runtime) {
    rows.push({
      status: toRowStatus(applyResult.runtime.status),
      target: "runtime",
      path: applyResult.runtime.cliPath,
    });
  }
  for (const agentResult of applyResult.agents) {
    for (const entry of agentResult.plan) {
      rows.push(rowFromPlanEntry(agentResult.agent.id, entry));
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
          // No `forceAction` — hooks always-converge with no conflict/`--force`
          // gate (see `AgentAdapter#installHooks`'s own docs), so a hook row
          // never lands in RowStatus "modified".
        });
      }
    }
  }
  return rows;
}

/**
 * The trailing `state` row both `setup` and `migrate` append — same
 * create/update/current rule either way, so the two callers can't drift on
 * how a ledger write is reported. `ledgerChanged` is each caller's own
 * computation; this only owns turning that bit plus prior-state nullness
 * into a `Row`.
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
    forget: 0,
    modified: 0,
  };
  for (const row of rows) {
    counts[row.status]++;
  }

  const acted: string[] = [];
  for (const status of ["create", "update", "delete", "forget"] as const) {
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
 * Per-agent hook failures `applyAgentInstalls` isolated (see
 * `AgentApplyResult#error`) — printed after the table/summary so a failing
 * agent's hook error doesn't obscure whether other agents (or this agent's
 * own whole-file artifacts, already applied by this point) succeeded.
 */
export function renderAgentErrors(applyResult: ApplyAgentInstallsResult): void {
  const failed = applyResult.agents.filter(
    (a): a is typeof a & { error: string } => a.error !== undefined,
  );
  if (failed.length === 0) {
    return;
  }
  process.stderr.write(
    `\n${plural(failed.length, "agent")} hook install failed (its other artifacts above still applied):\n`,
  );
  for (const { agent, error } of failed) {
    process.stderr.write(`  ${agent.id}: ${error}\n`);
  }
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
