import path from "node:path";
import { parseHandoffFrontmatter } from "../util/frontmatter.js";
import { findUsableHandoff } from "./find-usable-handoff.js";

/** `YYYY-MM-DD-HHmm` or `YYYY-MM-DD-HHmmss`, optionally followed by `-slug`. */
const TIMESTAMP_STEM = /^(\d{4}-\d{2}-\d{2})-\d{4}(?:\d{2})?(?:-(.*))?$/;

/**
 * Derive a display label from a handoff filename when frontmatter has no title:
 * strip the timestamp prefix and `.md`, replace `-` with spaces.
 */
export function labelFromHandoffFilename(filePath: string): string {
  const stem = path.basename(filePath, ".md");
  const match = TIMESTAMP_STEM.exec(stem);
  if (!match) {
    return stem.replace(/-/g, " ");
  }
  const slug = match[2];
  if (!slug) {
    return "";
  }
  return slug.replace(/-/g, " ");
}

function createdDateFromFilename(filePath: string): string | undefined {
  const stem = path.basename(filePath, ".md");
  const match = TIMESTAMP_STEM.exec(stem);
  return match?.[1];
}

/** Prefer frontmatter `created` ISO prefix; else filename date. */
function formatCreatedDate(created: string | undefined, filePath: string): string | undefined {
  if (created) {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(created);
    if (match) {
      return match[1];
    }
  }
  return createdDateFromFilename(filePath);
}

export interface CurrentHandoffLabel {
  label: string;
  createdDate: string;
}

/**
 * Resolves the label/date for the newest *usable* handoff under `logsDir`
 * (via {@link findUsableHandoff}), or `undefined` when there is none or it has
 * no derivable date. Single source of truth shared by `handoff peek` (the
 * SessionStart hook) and `statusline` (the Claude Code status bar) — both
 * must agree on "the current handoff".
 */
export async function resolveCurrentHandoffLabel(
  logsDir: string,
): Promise<CurrentHandoffLabel | undefined> {
  const usable = await findUsableHandoff(logsDir);
  if (!usable) {
    return undefined;
  }
  const fm = parseHandoffFrontmatter(usable.content);
  const label = fm.title?.trim() || labelFromHandoffFilename(usable.path);
  const createdDate = formatCreatedDate(fm.created, usable.path);
  if (!createdDate) {
    return undefined;
  }
  return { label, createdDate };
}
