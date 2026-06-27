import { sanitizeProjectId } from "./project-id.js";

export function slugifyText(text: string): string {
  return sanitizeProjectId(text.trim().slice(0, 80));
}

export function timestampSlug(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");
}

export function timeSuffix(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}${pad(date.getMinutes())}`;
}
