import { withHomeDir } from "../connector/home.js";
import { resolveLogsDir, resolveNotesDir, resolvePlansDir } from "../connector/vault.js";
import { helpExitCode } from "../help.js";
import { flagBool, parseArgs } from "../util/parse-args.js";
import {
  formatMarkdownFileLink,
  toFileUri,
  vaultItemPlainTitle,
  vaultRelativePath,
} from "../util/path.js";
import { listHandoffsDetailed } from "../vault/list-handoffs.js";
import { listNotesDetailed } from "../vault/list-notes.js";
import { listPlansDetailed } from "../vault/list-plans.js";
import { type VaultItemListNoun, writeSection } from "./output.js";
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
   * plain bucket-relative stem path). Either way the title line also carries
   * "— updated YYYY-MM-DD".
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

/** A listed file plus the mtime already fetched to rank it. */
interface Entry {
  path: string;
  mtimeMs: number;
}

interface Bucket {
  dir: string;
  noun: VaultItemListNoun;
  /** Section heading for text/markdown mode ("Notes", "Handoffs", "Plans"). */
  title: string;
  /** Every markdown file in this bucket, newest first (uncapped). */
  all: Entry[];
  /** `all` capped to the requested limit — what text/markdown mode prints. */
  shown: Entry[];
}

/**
 * Lists a bucket uncapped (each lister already builds this full sorted array
 * internally before slicing, so this costs no extra traversal) and slices
 * locally — giving `--json` an honest `total` instead of reporting the
 * shown-count twice under different names.
 */
async function gatherBucket(
  dir: string,
  noun: VaultItemListNoun,
  title: string,
  limit: number,
  lister: (dir: string, options?: { limit?: number }) => Promise<Entry[]>,
): Promise<Bucket> {
  const all = await lister(dir);
  return { dir, noun, title, all, shown: all.slice(0, limit) };
}

/** `YYYY-MM-DD` — deterministic and matches the ISO dates already used in plan frontmatter. */
function formatEntryDate(mtimeMs: number): string {
  return new Date(mtimeMs).toISOString().slice(0, 10);
}

function jsonBucket(bucket: Bucket) {
  return {
    total: bucket.all.length,
    count: bucket.shown.length,
    truncated: bucket.all.length > bucket.shown.length,
    items: bucket.shown.map((entry) => ({
      path: entry.path,
      relativePath: vaultRelativePath(bucket.dir, entry.path),
      fileUri: toFileUri(entry.path),
      mtimeMs: entry.mtimeMs,
    })),
  };
}

/**
 * Header line for one bucket's text/markdown section. Unlike the shared
 * `note`/`handoff`/`plan list` header (`writeVaultItemList`'s
 * `count === limit` → "there may be more" guess), overview already has the
 * true total for free (see {@link gatherBucket}), so it reports an exact
 * "N of M" instead of a maybe — the `--markdown` skill path relays this
 * straight to the agent, where an honest count matters more than terseness.
 */
function bucketHeader(bucket: Bucket): string {
  const total = bucket.all.length;
  const shown = bucket.shown.length;
  if (total === 0) {
    return `No ${bucket.noun.plural}.\n`;
  }
  if (shown === total) {
    const label = total === 1 ? bucket.noun.singular : bucket.noun.plural;
    return `All ${total} ${label}:\n\n`;
  }
  return `Most recent ${shown} of ${total} ${bucket.noun.plural}:\n\n`;
}

/**
 * Numbered title + absolute-path blocks for one bucket, each title line
 * suffixed with "— updated YYYY-MM-DD" and ending in two trailing spaces (a
 * Markdown hard line break, matching the `note`/`handoff`/`plan list`
 * convention) so agents can relay stdout into chat and keep title, date, and
 * path on separate rendered lines.
 *
 * Deliberately not routed through the shared `writeVaultItemListEntries` in
 * `output.ts` — that helper is also used by `note`/`handoff`/`plan list`,
 * whose output format this change isn't meant to touch, so overview owns its
 * own (nearly identical) entry line here instead of adding a date parameter
 * to shared code three other commands don't want.
 */
function writeBucketEntries(bucket: Bucket, markdown: boolean): void {
  bucket.shown.forEach((entry, index) => {
    if (index > 0) {
      process.stdout.write("\n");
    }
    const title = markdown
      ? formatMarkdownFileLink(vaultRelativePath(bucket.dir, entry.path), entry.path)
      : vaultItemPlainTitle(entry.path, bucket.dir);
    const updated = formatEntryDate(entry.mtimeMs);
    process.stdout.write(`${index + 1}. ${title} — updated ${updated}  \n  ${entry.path}\n`);
  });
}

function writeTextOutput(buckets: readonly Bucket[], markdown: boolean): void {
  buckets.forEach((bucket, index) => {
    if (index > 0) {
      process.stdout.write("\n");
    }
    writeSection(bucket.title);
    process.stdout.write(bucketHeader(bucket));
    writeBucketEntries(bucket, markdown);
  });
}

function writeJsonOutput(buckets: readonly Bucket[]): void {
  const payload: Record<string, ReturnType<typeof jsonBucket>> = {};
  for (const bucket of buckets) {
    payload[bucket.noun.plural] = jsonBucket(bucket);
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

/**
 * Resolves the linked project, gathers a per-bucket count + capped recent
 * titles (each with a last-updated date) across `notes/`, `logs/`
 * (handoffs), and `plans/` — the same newest-first listings
 * `note/handoff/plan list` use, in one call. No new storage; the mtime shown
 * is the same one each lister already fetches to rank entries (see
 * `listNotesDetailed` / `listHandoffsDetailed` / `listPlansDetailed`).
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
      gatherBucket(
        notesDir,
        { singular: "note", plural: "notes" },
        "Notes",
        limit,
        listNotesDetailed,
      ),
      gatherBucket(
        logsDir,
        { singular: "handoff", plural: "handoffs" },
        "Handoffs",
        limit,
        listHandoffsDetailed,
      ),
      gatherBucket(
        plansDir,
        { singular: "plan", plural: "plans" },
        "Plans",
        limit,
        listPlansDetailed,
      ),
    ]);

    if (options.json) {
      writeJsonOutput(buckets);
    } else {
      writeTextOutput(buckets, options.markdown === true);
    }
    return 0;
  });
}
