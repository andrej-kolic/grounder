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

function datePrefix(date: Date, includeSeconds: boolean): string {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${includeSeconds ? pad(date.getSeconds()) : ""}`;
  return `${y}-${m}-${d}-${time}`;
}

/** Local-time prefix `YYYY-MM-DD-HHmm` (legacy minute precision). */
export function dateMinutePrefix(date: Date): string {
  return datePrefix(date, false);
}

/** Local-time prefix `YYYY-MM-DD-HHmmss` for sortable filenames. */
export function dateSecondPrefix(date: Date): string {
  return datePrefix(date, true);
}

/**
 * @deprecated Prefer {@link dateSecondPrefix} (hyphenated date + time).
 * Legacy `YYYY-MM-DD-HH-mm-ss` form.
 */
export function timestampSlug(date = new Date()): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");
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
 * @deprecated Alias of {@link timestampedBasename} (always second precision).
 */
export function timestampedBasenameWithSeconds(
  text: string,
  options: { title?: string; now?: Date } = {},
): string {
  return timestampedBasename(text, options);
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
