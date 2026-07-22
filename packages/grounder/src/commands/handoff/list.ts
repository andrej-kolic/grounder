import { withHomeDir } from "../../connector/home.js";
import { resolveLogsDir } from "../../connector/vault.js";
import { listHandoffs } from "../../vault/list-handoffs.js";
import { flagString, parseArgs } from "../../util/parse-args.js";
import { requireLinkedProject } from "../require-linked.js";

const DEFAULT_LIMIT = 5;

/** Options for {@link runHandoffListWithOptions} (CLI parsing and tests). */
export interface HandoffListOptions {
  /** Directory used to find the linked repo (default: `process.cwd()`). */
  cwd?: string;
  /** Max paths to print, newest first (default: 5). */
  limit?: number;
  /** Override home dir / `GROUNDER_HOME` (tests). */
  homeDir?: string;
}

/**
 * CLI entry for `grounder handoff list [--limit <n>]`.
 * @returns Exit code (`0` on success, `1` on usage or config errors).
 */
export async function runHandoffList(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv);
  const limitRaw = flagString(flags, "limit");
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== undefined) {
    const trimmed = limitRaw.trim();
    const parsed = Number.parseInt(trimmed, 10);
    if (!/^\d+$/.test(trimmed) || Number.isNaN(parsed)) {
      process.stderr.write("Usage: grounder handoff list [--limit <n>]\n");
      return 1;
    }
    limit = parsed;
  }

  return runHandoffListWithOptions({ limit });
}

/**
 * Resolves the linked project, lists recent handoff paths under `logs/` (newest first).
 * Prints one absolute path per line; empty when no handoffs. Same vault/link
 * prerequisites as `grounder handoff`.
 * @returns Exit code (`0` on success, `1` when vault/link is missing).
 */
export async function runHandoffListWithOptions(
  options: HandoffListOptions = {},
): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const linked = await requireLinkedProject(options.cwd ?? process.cwd());
    if (!linked) {
      return 1;
    }

    const logsDir = resolveLogsDir(linked.home, linked.repo);
    const paths = await listHandoffs(logsDir, {
      limit: options.limit ?? DEFAULT_LIMIT,
    });

    for (const filePath of paths) {
      process.stdout.write(`${filePath}\n`);
    }
    return 0;
  });
}
