import { currentBranch } from "../connector/git.js";
import { withHomeDir } from "../connector/home.js";
import { resolveLogsDir } from "../connector/vault.js";
import { helpExitCode } from "../help.js";
import { flagString, parseArgs } from "../util/parse-args.js";
import { writeHandoff } from "../vault/write-handoff.js";
import { requireLinkedProject } from "./require-linked.js";

/** Options for {@link runHandoffWithOptions} (CLI parsing and tests). */
export interface HandoffOptions {
  /** Directory used to find the linked repo (default: `process.cwd()`). */
  cwd?: string;
  /** Markdown body stored under the project `logs/` folder. */
  text: string;
  /** Optional filename + frontmatter title slug (`--title`). */
  title?: string;
  /** Topic keywords for search (`--topics "auth,jwt,middleware"`). */
  topics?: string[];
  /** Override home dir / `GROUNDER_HOME` (tests). */
  homeDir?: string;
  /** Fixed clock for deterministic filenames and `created` (tests). */
  now?: Date;
}

/**
 * CLI entry for `grounder handoff <text> [--title <slug>]`.
 * @returns Exit code (`0` on success, `1` on usage or config errors).
 */
export async function runHandoff(argv: string[]): Promise<number> {
  const helpCode = helpExitCode(argv, "handoff");
  if (helpCode !== null) {
    return helpCode;
  }

  const { positional, flags } = parseArgs(argv);
  const text = positional.join(" ").trim();

  if (!text) {
    process.stderr.write("Usage: grounder handoff <text>\n");
    return 1;
  }

  const topicsRaw = flagString(flags, "topics");
  const topics = topicsRaw
    ? topicsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;

  return runHandoffWithOptions({
    text,
    title: flagString(flags, "title"),
    topics,
  });
}

/**
 * Resolves the linked project, writes a new handoff under `logs/`, prints `Wrote <path>`.
 * Same vault/link prerequisites as `grounder note`.
 * @returns Exit code (`0` on success, `1` when vault/link is missing).
 */
export async function runHandoffWithOptions(options: HandoffOptions): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const linked = await requireLinkedProject(options.cwd ?? process.cwd());
    if (!linked) {
      return 1;
    }

    const { home, repo, gitRoot } = linked;
    const logsDir = resolveLogsDir(home, repo);
    const branch = gitRoot ? await currentBranch(gitRoot) : undefined;
    const writtenPath = await writeHandoff(logsDir, options.text, {
      projectId: repo.projectId,
      title: options.title,
      branch,
      topics: options.topics,
      now: options.now,
    });

    process.stdout.write(`Wrote ${writtenPath}\n`);
    return 0;
  });
}
