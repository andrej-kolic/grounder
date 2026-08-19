import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseHandoffFrontmatter } from "../util/frontmatter.js";

/** One line-level match inside a markdown file. */
export interface SearchLineHit {
  line: number;
  matchedTerm: string;
  snippet: string;
}

/** Matches grouped by file, after ranking and per-file dedupe. */
export interface SearchFileHit {
  filePath: string;
  mtimeMs: number;
  topicsMatch: boolean;
  hits: SearchLineHit[];
}

export interface SearchOptions {
  /** Project vault root — searched recursively for `*.md`. */
  rootDir: string;
  /** Primary query phrase. */
  query: string;
  /** Extra keyword variants (deduped with query). */
  terms?: readonly string[];
  /** Max distinct files in the result (default 10). */
  limit?: number;
  /** Stop collecting line hits after this many (default 200). */
  maxHits?: number;
  /** Context lines around each match (default 1). */
  context?: number;
  /** Max line hits kept per file after grouping (default 3). */
  maxHitsPerFile?: number;
}

export interface SearchOutcome {
  query: string;
  terms: string[];
  totalMatchCount: number;
  totalFileCount: number;
  files: SearchFileHit[];
  truncated: boolean;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_HITS = 200;
const DEFAULT_CONTEXT = 1;
const DEFAULT_MAX_HITS_PER_FILE = 3;

/** Known vault subfolders — light tiebreaker after recency. */
const FOLDER_SIGNAL: Readonly<Record<string, number>> = {
  notes: 2,
  plans: 2,
  logs: 1,
};

function normalizeTerms(query: string, extra?: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [query, ...(extra ?? [])]) {
    const term = raw.trim();
    if (!term) {
      continue;
    }
    const key = term.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(term);
  }
  return out;
}

function termMatchesLine(line: string, term: string): boolean {
  return line.toLowerCase().includes(term.toLowerCase());
}

function findMatchingTerm(line: string, terms: readonly string[]): string | undefined {
  for (const term of terms) {
    if (termMatchesLine(line, term)) {
      return term;
    }
  }
  return undefined;
}

function topicsMatchTerms(
  topics: readonly string[] | undefined,
  terms: readonly string[],
): boolean {
  if (!topics?.length) {
    return false;
  }
  const lowered = topics.map((t) => t.toLowerCase());
  return terms.some((term) => lowered.includes(term.toLowerCase()));
}

function folderSignal(rootDir: string, filePath: string): number {
  const rel = path.relative(rootDir, filePath);
  const first = rel.split(path.sep)[0];
  return first ? (FOLDER_SIGNAL[first] ?? 0) : 0;
}

function buildSnippet(lines: readonly string[], lineIndex: number, context: number): string {
  const start = Math.max(0, lineIndex - context);
  const end = Math.min(lines.length - 1, lineIndex + context);
  const parts: string[] = [];
  for (let i = start; i <= end; i++) {
    parts.push(lines[i] ?? "");
  }
  return parts.join("\n");
}

async function listMarkdownFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(full);
      }
    }
  }

  await walk(rootDir);
  return results;
}

interface RawFileHits {
  filePath: string;
  mtimeMs: number;
  topicsMatch: boolean;
  hits: SearchLineHit[];
}

/**
 * Case-insensitive markdown scan under `rootDir`.
 * Frontmatter `topics:` matches boost file ranking; body and frontmatter lines
 * both contribute line hits. Pure fs — no index, no deps.
 */
export async function searchVault(options: SearchOptions): Promise<SearchOutcome> {
  const terms = normalizeTerms(options.query, options.terms);
  const limit = options.limit ?? DEFAULT_LIMIT;
  const maxHits = options.maxHits ?? DEFAULT_MAX_HITS;
  const context = options.context ?? DEFAULT_CONTEXT;
  const maxHitsPerFile = options.maxHitsPerFile ?? DEFAULT_MAX_HITS_PER_FILE;

  if (terms.length === 0) {
    return {
      query: options.query,
      terms: [],
      totalMatchCount: 0,
      totalFileCount: 0,
      files: [],
      truncated: false,
    };
  }

  const filePaths = await listMarkdownFiles(options.rootDir);
  const rawFiles: RawFileHits[] = [];
  let totalMatchCount = 0;
  let stopScan = false;

  for (const filePath of filePaths) {
    if (stopScan) {
      break;
    }

    let content: string;
    let mtimeMs: number;
    try {
      [content, { mtimeMs }] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    const frontmatter = parseHandoffFrontmatter(content);
    const topicsMatch = topicsMatchTerms(frontmatter.topics, terms);
    const fileHits: SearchLineHit[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (totalMatchCount >= maxHits) {
        stopScan = true;
        break;
      }

      const line = lines[i] ?? "";
      const matchedTerm = findMatchingTerm(line, terms);
      if (!matchedTerm) {
        continue;
      }

      fileHits.push({
        line: i + 1,
        matchedTerm,
        snippet: buildSnippet(lines, i, context),
      });
      totalMatchCount++;
    }

    if (fileHits.length > 0) {
      rawFiles.push({
        filePath,
        mtimeMs,
        topicsMatch,
        hits: fileHits.slice(0, maxHitsPerFile),
      });
    }
  }

  rawFiles.sort((a, b) => {
    if (a.mtimeMs !== b.mtimeMs) {
      return b.mtimeMs - a.mtimeMs;
    }
    if (a.topicsMatch !== b.topicsMatch) {
      return a.topicsMatch ? -1 : 1;
    }
    const folderDiff =
      folderSignal(options.rootDir, b.filePath) - folderSignal(options.rootDir, a.filePath);
    if (folderDiff !== 0) {
      return folderDiff;
    }
    return a.filePath.localeCompare(b.filePath);
  });

  const totalFileCount = rawFiles.length;
  const truncated = totalFileCount > limit;
  const files = rawFiles.slice(0, limit).map(({ filePath, mtimeMs, topicsMatch, hits }) => ({
    filePath,
    mtimeMs,
    topicsMatch,
    hits,
  }));

  return {
    query: options.query,
    terms,
    totalMatchCount,
    totalFileCount,
    files,
    truncated,
  };
}
