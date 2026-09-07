import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseHandoffFrontmatter } from "../util/frontmatter.js";
import { listMarkdownFiles } from "./list-markdown.js";

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
  /** Distinct matching terms (original spelling), longest first. */
  matchedTerms: string[];
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
  /**
   * Cap stored line snippets per file during scan (default 50; hard-capped at
   * 50). Does not abort the tree walk; ranking still uses full hit counts.
   */
  maxHits?: number;
  /** Context lines around each match (default 1). */
  context?: number;
  /** Max line hits kept per file after grouping (default 1). */
  maxHitsPerFile?: number;
  /** Exclude files with mtime before this date. */
  since?: Date;
}

export interface SearchOutcome {
  query: string;
  terms: string[];
  /** How many files each term matched (keyed by lowercased term). */
  termHitCounts: Record<string, number>;
  totalMatchCount: number;
  totalFileCount: number;
  files: SearchFileHit[];
  truncated: boolean;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_HITS = 50;
const DEFAULT_CONTEXT = 1;
const DEFAULT_MAX_HITS_PER_FILE = 1;
/** Cap line hits stored per file during scan (counts stay full for ranking). */
const MAX_STORED_HITS_PER_FILE = 50;

/** Known vault subfolders — light tiebreaker after recency. */
const FOLDER_SIGNAL: Readonly<Record<string, number>> = {
  notes: 2,
  plans: 2,
  logs: 1,
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Single-token terms only — phrases may contain spaces or punctuation. */
function isWordLikeTerm(term: string): boolean {
  return /^[\w-]+$/.test(term);
}

function pruneOverlappingTerms(query: string, terms: readonly string[]): string[] {
  const queryKey = query.trim().toLowerCase();
  return terms.filter((term) => {
    const lower = term.toLowerCase();
    if (lower === queryKey) {
      return true;
    }
    return !terms.some((other) => {
      if (other === term) {
        return false;
      }
      const otherLower = other.toLowerCase();
      if (otherLower.length <= lower.length || !isWordLikeTerm(term) || !isWordLikeTerm(other)) {
        return false;
      }
      return otherLower.startsWith(lower);
    });
  });
}

function normalizeTerms(query: string, extra?: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Always include the query — multi-word phrases use substring matching in
  // termMatchesLine, so exact phrases only match lines that contain them verbatim.
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
  return pruneOverlappingTerms(query, out);
}

/**
 * Soft-demote search dogfood notes when the user is not asking about search.
 * (`discussions/search/…`, `search-feature.md`, `Search Results.md`)
 */
function searchMetaPenalty(rootDir: string, filePath: string, query: string): number {
  if (/\bsearch\b/i.test(query)) {
    return 0;
  }
  const rel = path.relative(rootDir, filePath);
  const segments = rel.split(path.sep).map((segment) => segment.toLowerCase());
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] === "discussions" && segments[i + 1] === "search") {
      return 1;
    }
  }
  const stem = path.basename(filePath, path.extname(filePath)).toLowerCase();
  if (stem === "search-feature" || stem === "search results") {
    return 1;
  }
  return 0;
}

// Deliberately separate from termMatchesHaystack's dot-aware boundary below —
// body content has no dotted-pseudo-extension convention to guard against, so
// plain `\b` is correct here. Do not "unify" the two matchers: a shared regex
// would either reintroduce `plan` matching `<id>.plan.md` in filenames, or
// stop `.plan` matching `plan` in body text, silently changing one side.
function termMatchesLine(line: string, term: string): boolean {
  if (term.includes(" ")) {
    return line.toLowerCase().includes(term.toLowerCase());
  }
  const re = new RegExp(`\\b${escapeRegex(term)}\\b`, "i");
  return re.test(line);
}

function matchingTermsOnLine(line: string, terms: readonly string[]): string[] {
  return terms.filter((term) => termMatchesLine(line, term));
}

function longestTerm(matches: readonly string[]): string {
  return matches.reduce((best, term) => (term.length > best.length ? term : best));
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

/** Deprioritize archived plans/notes — still searchable, ranked lower. */
function archivePenalty(rootDir: string, filePath: string): number {
  const rel = path.relative(rootDir, filePath);
  const segments = rel.split(path.sep);
  return segments.some((segment) => segment.toLowerCase() === "archive") ? 1 : 0;
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

interface RawFileHits {
  filePath: string;
  mtimeMs: number;
  topicsMatch: boolean;
  hits: SearchLineHit[];
  distinctTermCount: number;
  totalHitCount: number;
  /** IDF-weighted density — computed after the full walk using global termDocFreq. */
  idfDensity: number;
  filenameTermCount: number;
  /**
   * Lowercased terms matched via this file's own filename stem (not parent
   * directories) — regardless of whether the term also matches in content.
   * Narrow enough to justify including a file that has no content match.
   */
  stemMatchedTerms: Set<string>;
  phraseMatch: boolean;
  partialPhraseMatch: boolean;
  /** Per-term line-hit counts for this file; used to compute idfDensity. */
  perTermHits: Map<string, number>;
}

/**
 * `.` only counts as a word character on the *leading* side of a match
 * (unlike `\b`'s default), so a term can't start right after a dot — this
 * stops a dotted filename convention like `<id>.plan.md` from letting a
 * generic term match its dotted suffix as a standalone word (query "plan"
 * must not match every `*.plan.md` file), while still letting the id itself
 * match (`schema_versioning` must match `schema_versioning.plan.md`) since a
 * term is still allowed to *end* right before a dot. `\w`-based boundaries
 * are otherwise unchanged from before this fix: a hyphen still splits words
 * (`search` matches `search-feature.md`), but `_` does not (`search` does
 * *not* match `search_feature.md` — same as `\b`'s existing behavior).
 */
function termMatchesHaystack(haystack: string, lower: string): boolean {
  if (lower.includes(" ")) {
    return haystack.includes(lower);
  }
  const escaped = escapeRegex(lower);
  return new RegExp(`(?<![\\w.])${escaped}(?!\\w)`, "i").test(haystack);
}

/**
 * Lowercased `terms` that appear in `filePath`'s vault-relative path,
 * including parent directory names (e.g. `plans/p1.md` matches both `plans`
 * and `p1`). Ranking signal only (`filenameTermCount`) — never a matching
 * gate, since a query for a common folder name (`plans`, `notes`, `archive`)
 * would otherwise return every file in that folder regardless of content.
 */
function pathMatchedTerms(
  rootDir: string,
  filePath: string,
  terms: readonly string[],
): Set<string> {
  const rel = path.relative(rootDir, filePath);
  const haystack = rel.replace(/[/\\]/g, " ").replace(/\.md$/i, "").toLowerCase();
  const matched = new Set<string>();
  for (const term of terms) {
    const lower = term.toLowerCase();
    if (termMatchesHaystack(haystack, lower)) {
      matched.add(lower);
    }
  }
  return matched;
}

/**
 * Lowercased `terms` that appear in `filePath`'s own filename stem only (no
 * parent directories, no extension) — e.g. `plans/pluggable.md` matches
 * `pluggable` but not `plans`. Narrow enough to gate inclusion for a file
 * with no content match, unlike {@link pathMatchedTerms}.
 */
function stemMatchedTerms(filePath: string, terms: readonly string[]): Set<string> {
  const stem = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const matched = new Set<string>();
  for (const term of terms) {
    const lower = term.toLowerCase();
    if (termMatchesHaystack(stem, lower)) {
      matched.add(lower);
    }
  }
  return matched;
}

function contentHasPhrase(content: string, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed.includes(" ")) {
    return false;
  }
  return content.toLowerCase().includes(trimmed.toLowerCase());
}

/**
 * Partial n-gram match: 2 consecutive words for 3-word queries, 3 consecutive
 * words for 4+ word queries. Trigrams cut false positives where a doc only
 * shares a loose bigram (e.g. "slash commands") without migration context.
 */
function contentHasPartialPhrase(content: string, query: string): boolean {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) {
    return false;
  }
  const lower = content.toLowerCase();
  const windowSize = words.length >= 4 ? 3 : 2;
  for (let i = 0; i <= words.length - windowSize; i++) {
    const ngram = words
      .slice(i, i + windowSize)
      .join(" ")
      .toLowerCase();
    if (lower.includes(ngram)) {
      return true;
    }
  }
  return false;
}

function relevanceScore(file: RawFileHits, rootDir: string, query: string): number {
  return (
    file.distinctTermCount * 1000 +
    Math.min(file.idfDensity, 100) * 10 +
    (file.topicsMatch ? 800 : 0) +
    file.filenameTermCount * 200 +
    (file.phraseMatch ? 300 : 0) +
    (file.partialPhraseMatch ? 100 : 0) -
    // Strong enough to lose to real notes with similar distinct-term coverage
    // (meta dumps / search dogfood often win on raw hit density alone).
    searchMetaPenalty(rootDir, file.filePath, query) * 5000
  );
}

function pickBestHits(hits: SearchLineHit[], maxHitsPerFile: number): SearchLineHit[] {
  if (hits.length <= maxHitsPerFile) {
    return hits;
  }
  const sorted = [...hits].sort((a, b) => b.matchedTerm.length - a.matchedTerm.length);
  return sorted.slice(0, maxHitsPerFile);
}

/**
 * Case-insensitive markdown scan under `rootDir`.
 * Frontmatter `topics:` matches boost file ranking; body and frontmatter lines
 * both contribute line hits. Files rank by relevance (distinct terms, hit
 * density, filename/path terms, topics; demotes search dogfood when query is
 * unrelated), then archive, recency, folder. Pure fs — no index, no deps.
 */
export async function searchVault(options: SearchOptions): Promise<SearchOutcome> {
  const terms = normalizeTerms(options.query, options.terms);
  const limit = options.limit ?? DEFAULT_LIMIT;
  const maxHits = options.maxHits ?? DEFAULT_MAX_HITS;
  const context = options.context ?? DEFAULT_CONTEXT;
  const maxHitsPerFile = options.maxHitsPerFile ?? DEFAULT_MAX_HITS_PER_FILE;
  const perFileStoreCap = Math.min(MAX_STORED_HITS_PER_FILE, maxHits);

  if (terms.length === 0) {
    return {
      query: options.query,
      terms: [],
      termHitCounts: {},
      totalMatchCount: 0,
      totalFileCount: 0,
      files: [],
      truncated: false,
    };
  }

  const filePaths = await listMarkdownFiles(options.rootDir);
  const rawFiles: RawFileHits[] = [];
  let totalMatchCount = 0;
  // Lowercased doc-freq for ranking; JSON output remaps to original `terms` spelling.
  const termDocFreq: Record<string, number> = Object.fromEntries(
    terms.map((t) => [t.toLowerCase(), 0]),
  );

  for (const filePath of filePaths) {
    let content: string;
    let mtimeMs: number;
    try {
      [content, { mtimeMs }] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    } catch {
      continue;
    }

    if (options.since !== undefined && mtimeMs < options.since.getTime()) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    const frontmatter = parseHandoffFrontmatter(content);
    const topicsMatch = topicsMatchTerms(frontmatter.topics, terms);
    const fileHits: SearchLineHit[] = [];
    const matchedTerms = new Set<string>();
    const perTermHits = new Map<string, number>();
    let totalHitCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const lineMatches = matchingTermsOnLine(line, terms);
      if (lineMatches.length === 0) {
        continue;
      }

      for (const term of lineMatches) {
        const termKey = term.toLowerCase();
        matchedTerms.add(termKey);
        perTermHits.set(termKey, (perTermHits.get(termKey) ?? 0) + 1);
      }
      totalHitCount++;
      totalMatchCount++;

      if (fileHits.length < perFileStoreCap) {
        fileHits.push({
          line: i + 1,
          matchedTerm: longestTerm(lineMatches),
          snippet: buildSnippet(lines, i, context),
        });
      }
    }

    // Path terms (dir segments + stem) stay a ranking-only signal — they must
    // never gate inclusion, or a query for a common folder name (`plans`,
    // `notes`, `archive`) would return every file in that folder regardless
    // of content. The *matcher* underneath did change (shares
    // termMatchesHaystack's dot-boundary fix with stem matching below), so a
    // content-matching `<id>.plan.md` no longer earns filenameTermCount for
    // its dotted suffix — only the gating behavior is unchanged, not the
    // matcher itself.
    const pathTerms = pathMatchedTerms(options.rootDir, filePath, terms);
    // Stem terms are narrow enough (the file's own name, not its folder) to
    // justify surfacing a file that has no content match at all — e.g.
    // `pluggable.md`, whose body never repeats the word "pluggable".
    const stemTerms = stemMatchedTerms(filePath, terms);

    if (matchedTerms.size === 0 && stemTerms.size > 0) {
      // Every other zero-hit check in the CLI and its consumers (summary
      // text, JSON, the extension's QuickPick) keys off `totalMatchCount`,
      // not file count — count the title match itself so a filename-only
      // result doesn't get reported as "no matches" while still returning a hit.
      totalMatchCount++;
    }
    if (matchedTerms.size > 0 || stemTerms.size > 0) {
      for (const t of stemTerms) {
        // Only stem terms feed doc-freq (not the wider path terms): a term
        // that only ever appears in a title should still show a nonzero
        // `termHitCounts`, so the skill's zero-hit "bad term" broaden check
        // doesn't misfire on it — but a common folder name shouldn't inflate
        // every other term's IDF weighting.
        if (!matchedTerms.has(t)) {
          termDocFreq[t] = (termDocFreq[t] ?? 0) + 1;
        }
      }
      for (const t of matchedTerms) {
        termDocFreq[t] = (termDocFreq[t] ?? 0) + 1;
      }
      rawFiles.push({
        filePath,
        mtimeMs,
        topicsMatch,
        hits: fileHits,
        // Content-only: a filename/stem match justifies inclusion (above)
        // and still earns the flat `filenameTermCount` rank bonus below, but
        // doesn't inflate distinct-term coverage — a file that only matches
        // by title shouldn't outrank one that actually discusses the topic.
        distinctTermCount: matchedTerms.size,
        totalHitCount,
        idfDensity: 0,
        filenameTermCount: pathTerms.size,
        stemMatchedTerms: stemTerms,
        phraseMatch: contentHasPhrase(content, options.query),
        partialPhraseMatch: contentHasPartialPhrase(content, options.query),
        perTermHits,
      });
    }
  }

  // Scale hit density by IDF so rare identifiers outweigh common tokens like "grounder".
  for (const file of rawFiles) {
    let density = 0;
    for (const [term, count] of file.perTermHits) {
      const df = termDocFreq[term] ?? 1;
      density += count / Math.log(1 + df);
    }
    file.idfDensity = density;
  }

  rawFiles.sort((a, b) => {
    const scoreDiff =
      relevanceScore(b, options.rootDir, options.query) -
      relevanceScore(a, options.rootDir, options.query);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    const archiveDiff =
      archivePenalty(options.rootDir, a.filePath) - archivePenalty(options.rootDir, b.filePath);
    if (archiveDiff !== 0) {
      return archiveDiff;
    }
    if (a.mtimeMs !== b.mtimeMs) {
      return b.mtimeMs - a.mtimeMs;
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
  const files = rawFiles.slice(0, limit).map((file) => ({
    filePath: file.filePath,
    mtimeMs: file.mtimeMs,
    topicsMatch: file.topicsMatch,
    hits: pickBestHits(file.hits, maxHitsPerFile),
    matchedTerms: terms
      .filter(
        (term) =>
          file.perTermHits.has(term.toLowerCase()) || file.stemMatchedTerms.has(term.toLowerCase()),
      )
      .sort((a, b) => b.length - a.length),
  }));

  return {
    query: options.query,
    terms,
    termHitCounts: Object.fromEntries(
      terms.map((term) => [term, termDocFreq[term.toLowerCase()] ?? 0]),
    ),
    totalMatchCount,
    totalFileCount,
    files,
    truncated,
  };
}
