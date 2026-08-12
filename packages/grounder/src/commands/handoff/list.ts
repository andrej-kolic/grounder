import path from "node:path";
import { withHomeDir } from "../../connector/home.js";
import { resolveLogsDir } from "../../connector/vault.js";
import { helpExitCode } from "../../help.js";
import { flagBool, parseArgs } from "../../util/parse-args.js";
import { findUsableHandoff } from "../../vault/find-usable-handoff.js";
import { listHandoffs } from "../../vault/list-handoffs.js";
import { requireLinkedProject } from "../require-linked.js";

const DEFAULT_LIMIT = 5;

/** Options for {@link runHandoffListWithOptions} (CLI parsing and tests). */
export interface HandoffListOptions {
  /** Directory used to find the linked repo (default: `process.cwd()`). */
  cwd?: string;
  /**
   * Default list: max handoffs to print, newest first (default: 5).
   * With `--head`: bounds the usable-handoff fallback scan only (not output count).
   */
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
  const helpCode = helpExitCode(argv, "handoff list");
  if (helpCode !== null) {
    return helpCode;
  }

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

function handoffNoun(count: number): string {
  return count === 1 ? "handoff" : "handoffs";
}

/**
 * Lead line for `handoff list` stdout: truncation signal when `count === limit`,
 * complete inventory when fewer, or empty-dir notice.
 */
export function formatHandoffListHeader(count: number, limit: number): string {
  if (count === 0) {
    return "No handoffs.\n";
  }
  if (count === limit) {
    return `Most recent ${count} ${handoffNoun(count)} (there may be more):\n\n`;
  }
  return `All ${count} ${handoffNoun(count)}:\n\n`;
}

/**
 * Resolves the linked project, lists recent handoffs under `logs/` (newest first).
 * Default: prints a count header (blank line after when non-empty), then each
 * handoff as a numbered two-line block — `N. ` + full filename stem (including
 * timestamp prefix), then the indented absolute path — separated by a blank
 * line. The title line ends with two trailing spaces (a Markdown hard line
 * break) so agents can relay stdout into chat and keep title and path on
 * separate rendered lines. When `logs/` is empty, prints `No handoffs.` only.
 * The number is positional within this listing only (not a stable identifier).
 * With `head: true`, prints only the single newest *usable* handoff path (or
 * empty stdout) — see {@link findUsableHandoff}. Same vault/link prerequisites
 * as `grounder handoff`.
 * @returns Exit code (`0` on success, `1` when vault/link is missing).
 */
export async function runHandoffListWithOptions(options: HandoffListOptions = {}): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const linked = await requireLinkedProject(options.cwd ?? process.cwd());
    if (!linked) {
      return 1;
    }

    const limit = options.limit ?? DEFAULT_LIMIT;
    const logsDir = resolveLogsDir(linked.home, linked.repo);

    if (options.head) {
      const usable = await findUsableHandoff(logsDir, { limit });
      if (usable) {
        process.stdout.write(`${usable.path}\n`);
      }
      return 0;
    }

    const paths = await listHandoffs(logsDir, { limit });

    process.stdout.write(formatHandoffListHeader(paths.length, limit));

    paths.forEach((filePath, index) => {
      if (index > 0) {
        process.stdout.write("\n");
      }
      const stem = path.basename(filePath, ".md");
      // Two trailing spaces: Markdown hard break when stdout is relayed into chat.
      process.stdout.write(`${index + 1}. ${stem}  \n  ${filePath}\n`);
    });
    return 0;
  });
}
