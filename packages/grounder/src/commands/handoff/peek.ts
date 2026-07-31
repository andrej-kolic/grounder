import path from "node:path";
import { readCursorHookWorkspaceRoot } from "../../agents/cursor-hook-input.js";
import { withHomeDir } from "../../connector/home.js";
import { resolveLinkedProject } from "../../connector/linked.js";
import { resolveLogsDir } from "../../connector/vault.js";
import { parseHandoffFrontmatter } from "../../util/frontmatter.js";
import { flagBool, parseArgs } from "../../util/parse-args.js";
import { findUsableHandoff } from "../../vault/find-usable-handoff.js";

/** Options for {@link runHandoffPeekWithOptions} (CLI and tests). */
export interface HandoffPeekOptions {
  /** Directory used to find the linked repo (default: `process.cwd()`). */
  cwd?: string;
  /** Override home dir / `GROUNDER_HOME` (tests). */
  homeDir?: string;
  /**
   * When true, always emit one JSON line for Cursor's `sessionStart` contract
   * (`{ additional_context }` or `{}`). Default plain-text output is for Claude.
   */
  json?: boolean;
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

function writePeekOutput(teaser: string | undefined, json: boolean | undefined): void {
  if (json) {
    process.stdout.write(
      teaser === undefined ? "{}\n" : `${JSON.stringify({ additional_context: teaser })}\n`,
    );
    return;
  }
  if (teaser !== undefined) {
    process.stdout.write(`${teaser}\n`);
  }
}

/**
 * CLI entry for `grounder handoff peek`.
 * Silent by default: prints nothing and exits 0 when unlinked, empty, or on any error.
 * Used by session-start hooks — must never crash or print noise.
 * Reads Cursor hook stdin for `workspace_roots[0]` when present (user-level
 * hooks run with cwd under `~/.cursor`, not the open workspace).
 * Pass `--json` for Cursor's `additional_context` stdout contract.
 * @returns Always `0`.
 */
export async function runHandoffPeek(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv);
  const stdinWorkspaceRoot = await readCursorHookWorkspaceRoot(process.stdin);
  return runHandoffPeekWithOptions({
    cwd: stdinWorkspaceRoot,
    json: flagBool(flags, "json"),
  });
}

/**
 * Resolves the linked project and prints a one-line teaser for the newest *usable*
 * handoff, or nothing. "Usable" (via {@link findUsableHandoff}) skips empty/unreadable
 * files and falls back to the next-newest — the same selection `grounder handoff list
 * --head` uses, so the teaser and `/grounder-task` never disagree about which handoff
 * is current.
 * Uses {@link resolveLinkedProject} directly (not `requireLinkedProject`) so failures stay silent.
 * @returns Always `0`.
 */
export async function runHandoffPeekWithOptions(options: HandoffPeekOptions = {}): Promise<number> {
  try {
    return await withHomeDir(options.homeDir, async () => {
      let teaser: string | undefined;
      try {
        const resolved = await resolveLinkedProject(options.cwd ?? process.cwd());
        if (resolved.ok) {
          const logsDir = resolveLogsDir(resolved.value.home, resolved.value.repo);
          const usable = await findUsableHandoff(logsDir);
          if (usable) {
            const fm = parseHandoffFrontmatter(usable.content);
            const label = fm.title?.trim() || labelFromHandoffFilename(usable.path);
            const createdDate = formatCreatedDate(fm.created, usable.path);
            if (createdDate) {
              teaser = `[grounder] Latest handoff: "${label}" (${createdDate}). Run /grounder-task to load it, or ignore if unrelated.`;
            }
          }
        }
      } catch {
        teaser = undefined;
      }
      writePeekOutput(teaser, options.json);
      return 0;
    });
  } catch {
    writePeekOutput(undefined, options.json);
    return 0;
  }
}
