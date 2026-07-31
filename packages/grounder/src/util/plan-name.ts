import { sanitizeProjectId } from "./project-id.js";

/** Generous cap for plan filenames — real plan names often exceed note/handoff's 20-char slug. */
export const MAX_PLAN_NAME_LENGTH = 80;

/**
 * Sanitize a `--title` value into a filename-safe plan name.
 * Trims, strips a trailing `.md` (case-insensitive), applies {@link sanitizeProjectId}
 * character rules, and caps at {@link MAX_PLAN_NAME_LENGTH}.
 * Returns `""` when the result is empty / unusable.
 */
export function sanitizePlanName(rawTitle: string): string {
  const trimmed = rawTitle.trim().replace(/\.md$/i, "");
  const sanitized = sanitizeProjectId(trimmed);
  if (!sanitized) {
    return "";
  }
  return sanitized.slice(0, MAX_PLAN_NAME_LENGTH).replace(/-+$/g, "");
}
