import { withHomeDir } from "../../connector/home.js";
import { resolveLogsDir } from "../../connector/vault.js";
import { flagBool, parseArgs } from "../../util/parse-args.js";
import { findUsableHandoff } from "../../vault/find-usable-handoff.js";
import { listHandoffs } from "../../vault/list-handoffs.js";
import { requireLinkedProject } from "../require-linked.js";

const DEFAULT_LIMIT = 5;

/** Options for {@link runHandoffListWithOptions} (CLI parsing and tests). */
export interface HandoffListOptions {
  /** Directory used to find the linked repo (default: `process.cwd()`). */
  cwd?: string;
  /** Max paths to print, newest first (default: 5). */
  limit?: number;
  /**
   * Print only the single newest *usable* handoff path (skips empty/unreadable
   * files), same selection `grounder handoff peek` uses. Ignores `limit` for
   * output count but still bounds the fallback scan.
   */
  head?: boolean;
  /** Override home dir / `GROUNDER_HOME` (tests). */
  homeDir?: string;
}

const USAGE = "Usage: grounder handoff list [--limit <n>] [--head]\n";

function usageError(): number {
  process.stderr.write(USAGE);
  return 1;
}

/**
 * CLI entry for `grounder handoff list [--limit <n>]`.
 * `--limit` must be a positive integer when provided.
 * @returns Exit code (`0` on success, `1` on usage or config errors).
 */
export async function runHandoffList(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  if (positional.length > 0) {
    return usageError();
  }

  for (const key of flags.keys()) {
    if (key !== "limit" && key !== "head") {
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

  return runHandoffListWithOptions({ limit, head: flagBool(flags, "head") });
}

/**
 * Resolves the linked project, lists recent handoff paths under `logs/` (newest first).
 * Prints one absolute path per line; empty when no handoffs. Same vault/link
 * prerequisites as `grounder handoff`.
 * With `head: true`, prints only the single newest *usable* handoff path — see
 * {@link findUsableHandoff}. This is the selection `/grounder-task` should read,
 * matching what `grounder handoff peek` teases.
 * @returns Exit code (`0` on success, `1` when vault/link is missing).
 */
export async function runHandoffListWithOptions(options: HandoffListOptions = {}): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const linked = await requireLinkedProject(options.cwd ?? process.cwd());
    if (!linked) {
      return 1;
    }

    const logsDir = resolveLogsDir(linked.home, linked.repo);

    if (options.head) {
      const usable = await findUsableHandoff(logsDir, { limit: options.limit ?? DEFAULT_LIMIT });
      if (usable) {
        process.stdout.write(`${usable.path}\n`);
      }
      return 0;
    }

    const paths = await listHandoffs(logsDir, {
      limit: options.limit ?? DEFAULT_LIMIT,
    });

    for (const filePath of paths) {
      process.stdout.write(`${filePath}\n`);
    }
    return 0;
  });
}
