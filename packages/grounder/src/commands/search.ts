import path from "node:path";
import { pathToFileURL } from "node:url";
import { withHomeDir } from "../connector/home.js";
import { resolveProjectVaultRoot } from "../connector/vault.js";
import { helpExitCode } from "../help.js";
import { fileExists } from "../util/fs.js";
import { flagBool, flagString, parseArgs } from "../util/parse-args.js";
import { type SearchOutcome, searchVault } from "../vault/search.js";
import { requireLinkedProject } from "./require-linked.js";

/** Options for {@link runSearchWithOptions} (CLI parsing and tests). */
export interface SearchCommandOptions {
  cwd?: string;
  homeDir?: string;
  query: string;
  terms?: string[];
  limit?: number;
  maxHits?: number;
  context?: number;
  since?: Date;
  markdown?: boolean;
  json?: boolean;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_HITS = 50;

const USAGE =
  "Usage: grounder search <query> [--terms <csv>] [--limit <n>] [--max-hits <n>] [--context <n>] [--since <date>] [--markdown] [--json]\n";

function usageError(): number {
  process.stderr.write(USAGE);
  return 1;
}

function parseIntFlag(
  raw: string | boolean | undefined,
  label: string,
  min: number,
): number | null {
  if (raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  const parsed = Number.parseInt(trimmed, 10);
  const desc = min === 0 ? "a non-negative integer" : "a positive integer";
  if (!/^\d+$/.test(trimmed) || Number.isNaN(parsed) || parsed < min) {
    process.stderr.write(`Invalid ${label}: must be ${desc}.\n`);
    return null;
  }
  return parsed;
}

/**
 * Parses `--since` / `--after`: calendar date (`2026-08-01` = local midnight),
 * ISO datetime, or relative (`7d`, `30d`). Returns `null` on invalid input
 * (after writing an error message).
 */
function parseSinceDate(raw: string | boolean | undefined): Date | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string") {
    process.stderr.write("Invalid --since: expected a date string.\n");
    return null;
  }
  const trimmed = raw.trim();
  const relMatch = /^(\d+)d$/i.exec(trimmed);
  if (relMatch) {
    const days = Number.parseInt(relMatch[1] as string, 10);
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoDay) {
    const year = Number.parseInt(isoDay[1] as string, 10);
    const month = Number.parseInt(isoDay[2] as string, 10);
    const day = Number.parseInt(isoDay[3] as string, 10);
    const parsed = new Date(year, month - 1, day);
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      process.stderr.write(
        `Invalid --since: "${trimmed}" is not a valid date (use YYYY-MM-DD or Nd).\n`,
      );
      return null;
    }
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    process.stderr.write(
      `Invalid --since: "${trimmed}" is not a valid date (use YYYY-MM-DD or Nd).\n`,
    );
    return null;
  }
  return parsed;
}

function parseTermsCsv(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function fileStem(filePath: string): string {
  return path.basename(filePath, ".md");
}

function formatSummary(outcome: SearchOutcome): string {
  if (outcome.totalMatchCount === 0) {
    return `No matches for "${outcome.query}".`;
  }
  if (outcome.truncated) {
    return `Found ${outcome.totalMatchCount} matches in ${outcome.totalFileCount} files (showing ${outcome.files.length}).`;
  }
  return `Found ${outcome.totalMatchCount} matches in ${outcome.totalFileCount} files.`;
}

function writePlainOutput(outcome: SearchOutcome): void {
  process.stdout.write(`${formatSummary(outcome)}\n`);
  if (outcome.totalMatchCount === 0) {
    return;
  }

  if (outcome.truncated) {
    process.stdout.write(
      `Showing top ${outcome.files.length} of ${outcome.totalFileCount} files.\n`,
    );
  }

  process.stdout.write("\n");

  outcome.files.forEach((file, index) => {
    if (index > 0) {
      process.stdout.write("\n");
    }
    const label = fileStem(file.filePath);
    const topicTag = file.topicsMatch ? " [topics]" : "";
    process.stdout.write(`${index + 1}. ${label}${topicTag}  \n  ${file.filePath}\n`);
    for (const hit of file.hits) {
      const snippet = hit.snippet.replace(/\s+/g, " ").trim();
      process.stdout.write(`  L${hit.line} (${hit.matchedTerm}): ${snippet}\n`);
    }
  });
}

function fileUri(filePath: string): string {
  return pathToFileURL(filePath).href;
}

function formatSnippetBlock(snippet: string): string {
  let fence = "```";
  while (snippet.includes(fence)) {
    fence += "`";
  }
  return `${fence}\n${snippet}\n${fence}\n`;
}

function writeMarkdownOutput(outcome: SearchOutcome): void {
  process.stdout.write(`${formatSummary(outcome)}\n`);
  if (outcome.totalMatchCount === 0) {
    return;
  }

  if (outcome.truncated) {
    process.stdout.write(
      `Showing top ${outcome.files.length} of ${outcome.totalFileCount} files.\n`,
    );
  }

  process.stdout.write("\n");

  for (const file of outcome.files) {
    const label = fileStem(file.filePath);
    process.stdout.write(`### [${label}](${fileUri(file.filePath)})\n\n`);
    for (const hit of file.hits) {
      process.stdout.write(`L${hit.line} (${hit.matchedTerm}):\n\n`);
      process.stdout.write(formatSnippetBlock(hit.snippet));
      process.stdout.write("\n");
    }
  }
}

function vaultRelativePath(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function alsoMatchedHint(filePath: string, matchedTerms: readonly string[]): string {
  const stem = fileStem(filePath);
  return `${stem} — ${matchedTerms.slice(0, 2).join(", ")}`;
}

function writeJsonOutput(outcome: SearchOutcome, rootDir: string): void {
  const payload = {
    query: outcome.query,
    terms: outcome.terms,
    termHitCounts: outcome.termHitCounts,
    summary: formatSummary(outcome),
    truncated: outcome.truncated,
    totalMatchCount: outcome.totalMatchCount,
    totalFileCount: outcome.totalFileCount,
    hits: outcome.files.map((file) => ({
      file: file.filePath,
      relativePath: vaultRelativePath(rootDir, file.filePath),
      fileUri: fileUri(file.filePath),
      alsoMatchedHint: alsoMatchedHint(file.filePath, file.matchedTerms),
      mtimeMs: file.mtimeMs,
      topicsMatch: file.topicsMatch,
      matches: file.hits.map((hit) => ({
        line: hit.line,
        term: hit.matchedTerm,
        snippet: hit.snippet,
      })),
    })),
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

/**
 * CLI entry for `grounder search <query>`.
 * @returns Exit code (`0` on success, `1` on usage or config errors).
 */
export async function runSearch(argv: string[]): Promise<number> {
  const helpCode = helpExitCode(argv, "search");
  if (helpCode !== null) {
    return helpCode;
  }

  const { positional, flags } = parseArgs(argv);

  if (positional.length === 0) {
    return usageError();
  }

  const allowedFlags = new Set([
    "terms",
    "limit",
    "max-hits",
    "context",
    "since",
    "after",
    "markdown",
    "json",
  ]);
  for (const key of flags.keys()) {
    if (!allowedFlags.has(key)) {
      return usageError();
    }
  }

  const markdown = flagBool(flags, "markdown");
  const json = flagBool(flags, "json");
  if (markdown && json) {
    process.stderr.write("Use only one of --markdown or --json.\n");
    return 1;
  }

  const limit = parseIntFlag(flags.get("limit"), "--limit", 1);
  if (limit === null && flags.has("limit")) {
    return 1;
  }

  const maxHits = parseIntFlag(flags.get("max-hits"), "--max-hits", 1);
  if (maxHits === null && flags.has("max-hits")) {
    return 1;
  }

  const context = parseIntFlag(flags.get("context"), "--context", 0);
  if (context === null && flags.has("context")) {
    return 1;
  }

  const sinceRaw = flags.get("since") ?? flags.get("after");
  const since = parseSinceDate(sinceRaw);
  if (since === null) {
    return 1;
  }

  const query = positional.join(" ").trim();
  if (!query) {
    return usageError();
  }

  return runSearchWithOptions({
    query,
    terms: parseTermsCsv(flagString(flags, "terms")),
    limit: limit ?? undefined,
    maxHits: maxHits ?? undefined,
    context: context ?? undefined,
    since: since ?? undefined,
    markdown,
    json,
  });
}

/**
 * Resolves the linked project, searches its vault root, prints formatted hits.
 */
export async function runSearchWithOptions(options: SearchCommandOptions): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const linked = await requireLinkedProject(options.cwd ?? process.cwd());
    if (!linked) {
      return 1;
    }

    const rootDir = resolveProjectVaultRoot(linked.home, linked.repo);
    if (!(await fileExists(rootDir))) {
      process.stderr.write(`Project vault root not found: ${rootDir}\n`);
      process.stderr.write("Run: grounder setup <vault-path>\n");
      return 1;
    }

    const outcome = await searchVault({
      rootDir,
      query: options.query,
      terms: options.terms,
      limit: options.limit ?? DEFAULT_LIMIT,
      maxHits: options.maxHits ?? DEFAULT_MAX_HITS,
      ...(options.context !== undefined ? { context: options.context } : {}),
      ...(options.since !== undefined ? { since: options.since } : {}),
    });

    if (options.json) {
      writeJsonOutput(outcome, rootDir);
    } else if (options.markdown) {
      writeMarkdownOutput(outcome);
    } else {
      writePlainOutput(outcome);
    }

    return 0;
  });
}
