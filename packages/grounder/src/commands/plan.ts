import path from "node:path";
import { withHomeDir } from "../connector/home.js";
import { resolvePlansDir } from "../connector/vault.js";
import { helpExitCode } from "../help.js";
import { fileExists } from "../util/fs.js";
import { flagBool, flagString, parseArgs } from "../util/parse-args.js";
import { isPathInside, resolveUserPath } from "../util/path.js";
import { sanitizePlanName } from "../util/plan-name.js";
import { updatePlanAtPath, writePlan } from "../vault/write-plan.js";
import { requireLinkedProject } from "./require-linked.js";

const USAGE =
  "Usage: grounder plan <text> --title <name> [--force]\n" +
  "   or: grounder plan <text> --path <file>";

/** Options for {@link runPlanWithOptions} (CLI parsing and tests). */
export interface PlanOptions {
  /** Directory used to find the linked repo (default: `process.cwd()`). */
  cwd?: string;
  /** Markdown body stored under the project `plans/` folder. */
  text: string;
  /** Required filename stem (`--title`); sanitized via {@link sanitizePlanName}. */
  title?: string;
  /**
   * Absolute or relative path to an existing plan file (`--path`).
   * Mutually exclusive with `--title`. Updates in place (no sanitization).
   */
  planPath?: string;
  /** When true, overwrite an existing plan (preserving original `created`). */
  force?: boolean;
  /** Override home dir / `GROUNDER_HOME` (tests). */
  homeDir?: string;
  /** Fixed clock for deterministic `created` / `updated` (tests). */
  now?: Date;
}

/**
 * CLI entry for `grounder plan <text> (--title <name> [--force] | --path <file>)`.
 * @returns Exit code (`0` on success, `1` on usage or config errors).
 */
export async function runPlan(argv: string[]): Promise<number> {
  const helpCode = helpExitCode(argv, "plan");
  if (helpCode !== null) {
    return helpCode;
  }

  const { positional, flags } = parseArgs(argv);
  const text = positional.join(" ").trim();

  if (!text) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }

  return runPlanWithOptions({
    text,
    title: flagString(flags, "title"),
    planPath: flagString(flags, "path"),
    force: flagBool(flags, "force"),
  });
}

/**
 * Resolves the linked project, writes/updates a named plan under `plans/`.
 * Prints `Wrote <path>` on create, `Updated <path>` on overwrite.
 * Without `--force`, an existing title-addressed plan prints a conflict hint and exits 1.
 * With `--path`, updates an existing file in place (must resolve under this project's `plans/`).
 * @returns Exit code (`0` on success, `1` on usage/conflict/link errors).
 */
export async function runPlanWithOptions(options: PlanOptions): Promise<number> {
  const hasTitle = options.title !== undefined;
  const hasPath = options.planPath !== undefined;

  if (hasTitle && hasPath) {
    process.stderr.write("Use either --title or --path, not both.\n");
    return 1;
  }

  if (!hasTitle && !hasPath) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }

  if (hasPath && options.force) {
    process.stderr.write("--force is not used with --path (path updates always overwrite).\n");
    return 1;
  }

  const sanitizedTitle = hasTitle ? sanitizePlanName(options.title ?? "") : undefined;
  if (hasTitle && !sanitizedTitle) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }

  return withHomeDir(options.homeDir, async () => {
    const linked = await requireLinkedProject(options.cwd ?? process.cwd());
    if (!linked) {
      return 1;
    }

    const plansDir = resolvePlansDir(linked.home, linked.repo);

    if (hasPath) {
      return updateByPath(plansDir, linked.repo.projectId, options);
    }

    if (!sanitizedTitle) {
      process.stderr.write(`${USAGE}\n`);
      return 1;
    }

    return writeByTitle(plansDir, linked.repo.projectId, sanitizedTitle, options);
  });
}

async function writeByTitle(
  plansDir: string,
  projectId: string,
  name: string,
  options: PlanOptions,
): Promise<number> {
  const result = await writePlan(plansDir, name, options.text, {
    projectId,
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
}

async function updateByPath(
  plansDir: string,
  projectId: string,
  options: PlanOptions,
): Promise<number> {
  const raw = options.planPath ?? "";
  const cwd = options.cwd ?? process.cwd();
  const filePath = resolveUserPath(raw, cwd);

  if (!filePath.toLowerCase().endsWith(".md")) {
    process.stderr.write(`Plan path must be a .md file under plans/: ${filePath}\n`);
    return 1;
  }

  if (!isPathInside(plansDir, filePath) || path.resolve(filePath) === path.resolve(plansDir)) {
    process.stderr.write(
      `Plan path must resolve inside this project's plans directory:\n  ${plansDir}\nGot: ${filePath}\n`,
    );
    return 1;
  }

  if (!(await fileExists(filePath))) {
    process.stderr.write(`Plan not found: ${filePath}\n`);
    return 1;
  }

  const result = await updatePlanAtPath(filePath, options.text, {
    projectId,
    now: options.now,
  });

  process.stdout.write(`Updated ${result.path}\n`);
  return 0;
}
