import { sanitizeProjectId } from "./project-id.js";

export const MAX_NOTE_SLUG_LENGTH = 20;

const pad = (n: number) => String(n).padStart(2, "0");

export function slugifyText(text: string): string {
  const firstLine = text.trim().split(/\r?\n/)[0] ?? "";
  return sanitizeProjectId(firstLine.trim().slice(0, MAX_NOTE_SLUG_LENGTH));
}

function datePrefix(date: Date, includeSeconds: boolean): string {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${includeSeconds ? pad(date.getSeconds()) : ""}`;
  return `${y}-${m}-${d}-${time}`;
}

export function dateMinutePrefix(date: Date): string {
  return datePrefix(date, false);
}

export function dateSecondPrefix(date: Date): string {
  return datePrefix(date, true);
}

/** @deprecated Kept for compatibility; prefer dateSecondPrefix. */
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

export function noteBasename(
  text: string,
  options: { title?: string; now?: Date } = {},
): string {
  const now = options.now ?? new Date();
  const shortSlug = options.title ? slugifyText(options.title) : slugifyText(text);
  const prefix = dateMinutePrefix(now);
  return shortSlug ? `${prefix}-${shortSlug}` : prefix;
}

export function noteBasenameWithSecondPrecision(
  text: string,
  options: { title?: string; now?: Date } = {},
): string {
  const now = options.now ?? new Date();
  const shortSlug = options.title ? slugifyText(options.title) : slugifyText(text);
  const prefix = dateSecondPrefix(now);
  return shortSlug ? `${prefix}-${shortSlug}` : prefix;
}
