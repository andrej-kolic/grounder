import { withHomeDir } from "../../connector/home.js";
import { resolvePlansDir } from "../../connector/vault.js";
import { helpExitCode } from "../../help.js";
import { parseArgs } from "../../util/parse-args.js";
import { listPlans } from "../../vault/list-plans.js";
import { requireLinkedProject } from "../require-linked.js";

const DEFAULT_LIMIT = 5;

/** Options for {@link runPlanListWithOptions} (CLI parsing and tests). */
export interface PlanListOptions {
  /** Directory used to find the linked repo (default: `process.cwd()`). */
  cwd?: string;
  /** Max paths to print, newest first (default: 5). */
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
 * Resolves the linked project, lists recent plan paths under `plans/` (newest first).
 * Prints one absolute path per line; empty when no plans. Same vault/link
 * prerequisites as `grounder plan`.
 * @returns Exit code (`0` on success, `1` when vault/link is missing).
 */
export async function runPlanListWithOptions(options: PlanListOptions = {}): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const linked = await requireLinkedProject(options.cwd ?? process.cwd());
    if (!linked) {
      return 1;
    }

    const plansDir = resolvePlansDir(linked.home, linked.repo);
    const paths = await listPlans(plansDir, {
      limit: options.limit ?? DEFAULT_LIMIT,
    });

    for (const filePath of paths) {
      process.stdout.write(`${filePath}\n`);
    }
    return 0;
  });
}
