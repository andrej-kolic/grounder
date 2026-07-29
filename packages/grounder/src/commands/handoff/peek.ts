import { readFile } from "node:fs/promises";
import path from "node:path";
import { withHomeDir } from "../../connector/home.js";
import { resolveLinkedProject } from "../../connector/linked.js";
import { resolveLogsDir } from "../../connector/vault.js";
import { parseHandoffFrontmatter } from "../../util/frontmatter.js";
import { listHandoffs } from "../../vault/list-handoffs.js";

/** Options for {@link runHandoffPeekWithOptions} (CLI and tests). */
export interface HandoffPeekOptions {
  /** Directory used to find the linked repo (default: `process.cwd()`). */
  cwd?: string;
  /** Override home dir / `GROUNDER_HOME` (tests). */
  homeDir?: string;
}

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

/**
 * CLI entry for `grounder handoff peek`.
 * Silent by default: prints nothing and exits 0 when unlinked, empty, or on any error.
 * Used by session-start hooks — must never crash or print noise.
 * @returns Always `0`.
 */
export async function runHandoffPeek(_argv: string[]): Promise<number> {
  return runHandoffPeekWithOptions();
}

/**
 * Resolves the linked project and prints a one-line teaser for the newest handoff, or nothing.
 * Uses {@link resolveLinkedProject} directly (not `requireLinkedProject`) so failures stay silent.
 * @returns Always `0`.
 */
export async function runHandoffPeekWithOptions(options: HandoffPeekOptions = {}): Promise<number> {
  try {
    return await withHomeDir(options.homeDir, async () => {
      try {
        const resolved = await resolveLinkedProject(options.cwd ?? process.cwd());
        if (!resolved.ok) {
          return 0;
        }

        const logsDir = resolveLogsDir(resolved.value.home, resolved.value.repo);
        const paths = await listHandoffs(logsDir, { limit: 1 });
        const newest = paths[0];
        if (!newest) {
          return 0;
        }

        let content = "";
        try {
          content = await readFile(newest, "utf8");
        } catch {
          return 0;
        }

        const fm = parseHandoffFrontmatter(content);
        const label = fm.title?.trim() || labelFromHandoffFilename(newest);
        const createdDate = formatCreatedDate(fm.created, newest);
        if (!createdDate) {
          return 0;
        }

        process.stdout.write(
          `[grounder] Latest handoff: "${label}" (${createdDate}). Run /grounder-task to load it, or ignore if unrelated.\n`,
        );
        return 0;
      } catch {
        return 0;
      }
    });
  } catch {
    return 0;
  }
}
