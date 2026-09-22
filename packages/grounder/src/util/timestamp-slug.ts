import { sanitizeProjectId } from "./project-id.js";

export const MAX_SLUG_LENGTH = 20;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Builds a short filesystem-safe slug from text.
 * Uses only the first line, truncated to {@link MAX_SLUG_LENGTH}.
 */
export function slugifyText(text: string): string {
  const firstLine = text.trim().split(/\r?\n/)[0] ?? "";
  return sanitizeProjectId(firstLine.trim().slice(0, MAX_SLUG_LENGTH));
}

/** UTC prefix `YYYY-MM-DD-HHmmss` for sortable filenames. */
export function dateSecondPrefix(date: Date): string {
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${y}-${m}-${d}-${hours}${minutes}${seconds}`;
}

/**
 * Filename stem: `YYYY-MM-DD-HHmmss` plus optional slug from `title`, else from `text`.
 * Returns the date prefix alone when the slug is empty.
 */
export function timestampedBasename(
  text: string,
  options: { title?: string; now?: Date } = {},
): string {
  const now = options.now ?? new Date();
  const shortSlug = options.title ? slugifyText(options.title) : slugifyText(text);
  const prefix = dateSecondPrefix(now);
  return shortSlug ? `${prefix}-${shortSlug}` : prefix;
}

/**
 * Numeric collision suffix for a basename that already exists.
 * Uses `_` so `base_02.md` sorts after `base.md` lexicographically
 * (`_` > `.`), keeping filename-desc “newest first” correct.
 * Zero-padded to 2 digits so `_02` < `_10`.
 */
export function collisionSuffix(n: number): string {
  return `_${String(n).padStart(2, "0")}`;
}
