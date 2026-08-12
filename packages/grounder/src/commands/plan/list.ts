import { withHomeDir } from "../../connector/home.js";
import { resolvePlansDir } from "../../connector/vault.js";
import { helpExitCode } from "../../help.js";
import { parseArgs } from "../../util/parse-args.js";
import { listPlans } from "../../vault/list-plans.js";
import { writeVaultItemList } from "../output.js";
import { requireLinkedProject } from "../require-linked.js";

const DEFAULT_LIMIT = 5;

/** Options for {@link runPlanListWithOptions} (CLI parsing and tests). */
export interface PlanListOptions {
  /** Directory used to find the linked repo (default: `process.cwd()`). */
  cwd?: string;
  /** Max plans to print, newest first (default: 5). */
  limit?: number;
  /** Override home dir / `GROUNDER_HOME` (tests). */
  homeDir?: string;
}

const USAGE = "Usage: grounder plan list [--limit <n>]\n";

function usageError(): number {
  process.stderr.write(USAGE);
  return 1;
}

/**
 * CLI entry for `grounder plan list [--limit <n>]`.
 * `--limit` must be a positive integer when provided.
 * @returns Exit code (`0` on success, `1` on usage or config errors).
 */
export async function runPlanList(argv: string[]): Promise<number> {
  const helpCode = helpExitCode(argv, "plan list");
  if (helpCode !== null) {
    return helpCode;
  }

  const { positional, flags } = parseArgs(argv);
  if (positional.length > 0) {
    return usageError();
  }

  for (const key of flags.keys()) {
    if (key !== "limit") {
      return usageError();
    }
  }

  const limitRaw = flags.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== undefined) {
    if (typeof limitRaw !== "string") {
      return usageError();
    }
    const trimmed = limitRaw.trim();
    const parsed = Number.parseInt(trimmed, 10);
    if (!/^\d+$/.test(trimmed) || Number.isNaN(parsed) || parsed < 1) {
      return usageError();
    }
    limit = parsed;
  }

  return runPlanListWithOptions({ limit });
}

/**
 * Resolves the linked project, lists recent plans under `plans/` (newest first).
 * Prints a count header (blank line after when non-empty), then each plan as a
 * numbered two-line block — `N. ` + filename stem (title), then the indented
 * absolute path — separated by a blank line. The title line ends with two
 * trailing spaces (a Markdown hard line break) so agents can relay stdout
 * into chat and keep title and path on separate rendered lines. When `plans/`
 * is empty, prints `No plans.` only. The number is positional within this
 * listing only (not a stable identifier — a later `plan list` call may
 * renumber if plans change) and exists purely so a human or agent can refer
 * to "plan 2" in the same conversation without retyping the path. Same
 * vault/link prerequisites as `grounder plan`.
 * @returns Exit code (`0` on success, `1` when vault/link is missing).
 */
export async function runPlanListWithOptions(options: PlanListOptions = {}): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const linked = await requireLinkedProject(options.cwd ?? process.cwd());
    if (!linked) {
      return 1;
    }

    const limit = options.limit ?? DEFAULT_LIMIT;
    const plansDir = resolvePlansDir(linked.home, linked.repo);
    const paths = await listPlans(plansDir, { limit });
    writeVaultItemList(paths, limit, { singular: "plan", plural: "plans" });
    return 0;
  });
}
