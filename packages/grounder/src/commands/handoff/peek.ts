import { readCursorHookWorkspaceRoot } from "../../agents/cursor-hook-input.js";
import { schemaMigrateNeeded } from "../../agents/schema-migrate-needed.js";
import { withHomeDir } from "../../connector/home.js";
import { resolveLinkedProject } from "../../connector/linked.js";
import { resolveLogsDir } from "../../connector/vault.js";
import { helpExitCode } from "../../help.js";
import { flagBool, parseArgs } from "../../util/parse-args.js";
import { resolveCurrentHandoffLabel } from "../../vault/current-handoff.js";

export { labelFromHandoffFilename } from "../../vault/current-handoff.js";

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

const MIGRATE_TEASER = "[grounder] Install outdated — run: grounder migrate.";

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
 * Resolve the workspace root for a Cursor sessionStart hook.
 * Prefer stdin `workspace_roots[0]`, then `CURSOR_PROJECT_DIR` (always set for
 * Cursor hook scripts), else leave undefined so callers fall back to `cwd`.
 */
function resolveCursorHookCwd(stdinWorkspaceRoot: string | undefined): string | undefined {
  if (stdinWorkspaceRoot !== undefined) {
    return stdinWorkspaceRoot;
  }
  const fromEnv = process.env.CURSOR_PROJECT_DIR?.trim();
  return fromEnv || undefined;
}

function composeTeaser(
  handoffLine: string | undefined,
  migrateNeeded: boolean,
): string | undefined {
  if (handoffLine && migrateNeeded) {
    return `${handoffLine}\n${MIGRATE_TEASER}`;
  }
  if (handoffLine) {
    return handoffLine;
  }
  if (migrateNeeded) {
    return MIGRATE_TEASER;
  }
  return undefined;
}

/**
 * CLI entry for `grounder handoff peek`.
 * Silent by default: prints nothing and exits 0 when unlinked, empty, or on any error
 * (unless install schemas are stale — then a one-line migrate nudge).
 * Used by session-start hooks — must never crash or print noise on stderr.
 * Reads Cursor hook stdin for `workspace_roots[0]` when present; falls back to
 * `CURSOR_PROJECT_DIR` (user-level hooks often run with cwd under `~/.cursor`).
 * Pass `--json` for Cursor's `additional_context` stdout contract.
 * @returns Always `0`.
 */
export async function runHandoffPeek(argv: string[]): Promise<number> {
  const helpCode = helpExitCode(argv, "handoff peek");
  if (helpCode !== null) {
    return helpCode;
  }

  const { flags } = parseArgs(argv);
  const stdinWorkspaceRoot = await readCursorHookWorkspaceRoot(process.stdin);
  return runHandoffPeekWithOptions({
    cwd: resolveCursorHookCwd(stdinWorkspaceRoot),
    json: flagBool(flags, "json"),
  });
}

/**
 * Resolves the linked project and prints a one-line teaser for the newest *usable*
 * handoff, or nothing. "Usable" (via {@link findUsableHandoff}) skips empty/unreadable
 * files and falls back to the next-newest — the same selection `grounder handoff list
 * --head` uses, so the teaser and `/grounder-task` never disagree about which handoff
 * is current.
 * Also checks `state.json` and may add a one-line "run grounder migrate" hint
 * for people who never run doctor.
 * Uses {@link resolveLinkedProject} directly (not `requireLinkedProject`) so failures stay silent.
 * @returns Always `0`.
 */
export async function runHandoffPeekWithOptions(options: HandoffPeekOptions = {}): Promise<number> {
  try {
    return await withHomeDir(options.homeDir, async () => {
      let handoffLine: string | undefined;
      try {
        const resolved = await resolveLinkedProject(options.cwd ?? process.cwd());
        if (resolved.ok) {
          const logsDir = resolveLogsDir(resolved.value.home, resolved.value.repo);
          const current = await resolveCurrentHandoffLabel(logsDir);
          if (current) {
            handoffLine = `[grounder] Latest handoff: "${current.label}" (${current.createdDate}). Run /grounder-task to load it, or ignore if unrelated.`;
          }
        }
      } catch {
        handoffLine = undefined;
      }

      const migrateNeeded = await schemaMigrateNeeded(options.homeDir);
      writePeekOutput(composeTeaser(handoffLine, migrateNeeded), options.json);
      return 0;
    });
  } catch {
    writePeekOutput(undefined, options.json);
    return 0;
  }
}
