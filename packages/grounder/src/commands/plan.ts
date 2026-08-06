import { withHomeDir } from "../connector/home.js";
import { resolvePlansDir } from "../connector/vault.js";
import { flagBool, flagString, parseArgs } from "../util/parse-args.js";
import { sanitizePlanName } from "../util/plan-name.js";
import { writePlan } from "../vault/write-plan.js";
import { requireLinkedProject } from "./require-linked.js";

/** Options for {@link runPlanWithOptions} (CLI parsing and tests). */
export interface PlanOptions {
  /** Directory used to find the linked repo (default: `process.cwd()`). */
  cwd?: string;
  /** Markdown body stored under the project `plans/` folder. */
  text: string;
  /** Required filename stem (`--title`); sanitized via {@link sanitizePlanName}. */
  title?: string;
  /** When true, overwrite an existing plan (preserving original `created`). */
  force?: boolean;
  /** Override home dir / `GROUNDER_HOME` (tests). */
  homeDir?: string;
  /** Fixed clock for deterministic `created` / `updated` (tests). */
  now?: Date;
}

/**
 * CLI entry for `grounder plan <text> --title <name> [--force]`.
 * @returns Exit code (`0` on success, `1` on usage or config errors).
 */
export async function runPlan(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const text = positional.join(" ").trim();

  if (!text) {
    process.stderr.write("Usage: grounder plan <text> --title <name>\n");
    return 1;
  }

  return runPlanWithOptions({
    text,
    title: flagString(flags, "title"),
    force: flagBool(flags, "force"),
  });
}

/**
 * Resolves the linked project, writes/updates a named plan under `plans/`.
 * Prints `Wrote <path>` on create, `Updated <path>` on overwrite.
 * Without `--force`, an existing plan prints a conflict hint and exits 1.
 * @returns Exit code (`0` on success, `1` on usage/conflict/link errors).
 */
export async function runPlanWithOptions(options: PlanOptions): Promise<number> {
  const name = sanitizePlanName(options.title ?? "");
  if (!name) {
    process.stderr.write("Usage: grounder plan <text> --title <name>\n");
    return 1;
  }

  return withHomeDir(options.homeDir, async () => {
    const linked = await requireLinkedProject(options.cwd ?? process.cwd());
    if (!linked) {
      return 1;
    }

    const plansDir = resolvePlansDir(linked.home, linked.repo);
    const result = await writePlan(plansDir, name, options.text, {
      projectId: linked.repo.projectId,
      force: options.force,
      now: options.now,
    });

    if (result.status === "exists") {
      process.stderr.write(`Plan already exists: ${result.path}\nUse --force to overwrite.\n`);
      return 1;
    }

    const verb = result.status === "overwritten" ? "Updated" : "Wrote";
    process.stdout.write(`${verb} ${result.path}\n`);
    return 0;
  });
}
