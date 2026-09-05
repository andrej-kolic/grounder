import { withHomeDir } from "../connector/home.js";
import { resolveLogsDir, resolveNotesDir, resolvePlansDir } from "../connector/vault.js";
import { helpExitCode } from "../help.js";
import { flagBool, parseArgs } from "../util/parse-args.js";
import { toFileUri, vaultRelativePath } from "../util/path.js";
import { listHandoffs } from "../vault/list-handoffs.js";
import { listNotes } from "../vault/list-notes.js";
import { listPlans } from "../vault/list-plans.js";
import { type VaultItemListNoun, writeSection, writeVaultItemList } from "./output.js";
import { requireLinkedProject } from "./require-linked.js";

const DEFAULT_LIMIT = 3;

/** Options for {@link runOverviewWithOptions} (CLI parsing and tests). */
export interface OverviewOptions {
  /** Directory used to find the linked repo (default: `process.cwd()`). */
  cwd?: string;
  /** Max recent titles to print per bucket (default: 3). */
  limit?: number;
  /**
   * Agent relay: `[bucketRelativePath](fileUri)` on each title line (default:
   * plain bucket-relative stem path).
   */
  markdown?: boolean;
  /** Structured JSON payload instead of formatted text. Mutually exclusive with `markdown`. */
  json?: boolean;
  /** Override home dir / `GROUNDER_HOME` (tests). */
  homeDir?: string;
}

const USAGE = "Usage: grounder overview [--limit <n>] [--markdown] [--json]\n";

function usageError(): number {
  process.stderr.write(USAGE);
  return 1;
}

/**
 * CLI entry for `grounder overview [--limit <n>] [--markdown] [--json]`.
 * `--limit` must be a positive integer when provided.
 * @returns Exit code (`0` on success, `1` on usage or config errors).
 */
export async function runOverview(argv: string[]): Promise<number> {
  const helpCode = helpExitCode(argv, "overview");
  if (helpCode !== null) {
    return helpCode;
  }

  const { positional, flags } = parseArgs(argv);
  if (positional.length > 0) {
    return usageError();
  }

  for (const key of flags.keys()) {
    if (key !== "limit" && key !== "markdown" && key !== "json") {
      return usageError();
    }
  }

  const markdown = flagBool(flags, "markdown");
  const json = flagBool(flags, "json");
  if (markdown && json) {
    process.stderr.write("Use only one of --markdown or --json.\n");
    return 1;
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

  return runOverviewWithOptions({ limit, markdown, json });
}

interface Bucket {
  dir: string;
  noun: VaultItemListNoun;
  paths: string[];
}

async function gatherBucket(
  dir: string,
  noun: VaultItemListNoun,
  limit: number,
  lister: (dir: string, options: { limit: number }) => Promise<string[]>,
): Promise<Bucket> {
  return { dir, noun, paths: await lister(dir, { limit }) };
}

function jsonBucket(bucket: Bucket, limit: number) {
  return {
    count: bucket.paths.length,
    truncated: bucket.paths.length === limit,
    items: bucket.paths.map((filePath) => ({
      path: filePath,
      relativePath: vaultRelativePath(bucket.dir, filePath),
      fileUri: toFileUri(filePath),
    })),
  };
}

function writeTextOutput(buckets: readonly Bucket[], limit: number, markdown: boolean): void {
  buckets.forEach((bucket, index) => {
    if (index > 0) {
      process.stdout.write("\n");
    }
    writeSection(bucket.noun.plural[0]?.toUpperCase() + bucket.noun.plural.slice(1));
    writeVaultItemList(bucket.paths, limit, bucket.noun, { markdown, titleRootDir: bucket.dir });
  });
}

function writeJsonOutput(buckets: readonly Bucket[], limit: number): void {
  const payload: Record<string, ReturnType<typeof jsonBucket>> = {};
  for (const bucket of buckets) {
    payload[bucket.noun.plural] = jsonBucket(bucket, limit);
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

/**
 * Resolves the linked project, gathers a per-bucket count + capped recent
 * titles across `notes/`, `logs/` (handoffs), and `plans/` — the same
 * newest-first listings `note/handoff/plan list` use, in one call. No new
 * storage or list logic; this only composes the existing listers.
 * @returns Exit code (`0` on success, `1` when vault/link is missing).
 */
export async function runOverviewWithOptions(options: OverviewOptions = {}): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const linked = await requireLinkedProject(options.cwd ?? process.cwd());
    if (!linked) {
      return 1;
    }

    const limit = options.limit ?? DEFAULT_LIMIT;
    const notesDir = resolveNotesDir(linked.home, linked.repo);
    const logsDir = resolveLogsDir(linked.home, linked.repo);
    const plansDir = resolvePlansDir(linked.home, linked.repo);

    const buckets = await Promise.all([
      gatherBucket(notesDir, { singular: "note", plural: "notes" }, limit, listNotes),
      gatherBucket(logsDir, { singular: "handoff", plural: "handoffs" }, limit, listHandoffs),
      gatherBucket(plansDir, { singular: "plan", plural: "plans" }, limit, listPlans),
    ]);

    if (options.json) {
      writeJsonOutput(buckets, limit);
    } else {
      writeTextOutput(buckets, limit, options.markdown === true);
    }
    return 0;
  });
}
