import { schemaMigrateNeeded } from "../agents/schema-migrate-needed.js";
import { withHomeDir } from "../connector/home.js";
import { resolveLinkedProject } from "../connector/linked.js";
import { resolveLogsDir } from "../connector/vault.js";
import { helpExitCode } from "../help.js";
import { readStdinWithTimeout } from "../util/read-stdin.js";
import { resolveCurrentHandoffLabel } from "../vault/current-handoff.js";
import { isFirstHandoffTeaserRender } from "./claude-statusline-teaser-state.js";

/** Max wait for Claude Code's statusLine JSON on stdin before giving up. */
const STDIN_TIMEOUT_MS = 200;

/** Options for {@link runStatuslineWithOptions} (CLI and tests). */
export interface StatuslineOptions {
  /** Directory used to find the linked repo (default: `process.cwd()`). */
  cwd?: string;
  /** Override home dir / `GROUNDER_HOME` (tests). */
  homeDir?: string;
  /**
   * Claude Code's stable per-session id (from stdin `session_id`). Gates the
   * handoff line to the session's first render — see
   * {@link isFirstHandoffTeaserRender}. Omit to always show (no suppression);
   * the migrate notice is never gated by this.
   */
  sessionId?: string;
}

const MIGRATE_NOTICE = "[grounder] install outdated — run: grounder migrate";

interface StatuslineStdinInput {
  cwd?: string;
  sessionId?: string;
}

/**
 * Read Claude Code's `statusLine` command payload from stdin: the workspace
 * directory and session id, when present.
 *
 * Claude Code pipes JSON like `{ "cwd": "...", "session_id": "...",
 * "workspace": { "current_dir": "..." } }` — prefer `workspace.current_dir`
 * (the project root Claude Code resolved) over top-level `cwd`.
 *
 * Never throws. Returns `{}` for TTY stdin, empty/malformed input, or when no
 * data arrives within the timeout.
 */
async function readStatuslineInput(
  stdin: NodeJS.ReadableStream = process.stdin,
): Promise<StatuslineStdinInput> {
  const raw = await readStdinWithTimeout(stdin, STDIN_TIMEOUT_MS);
  if (raw === undefined || raw.trim() === "") {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const obj = parsed as Record<string, unknown>;

    let cwd: string | undefined;
    const workspace = obj.workspace;
    if (workspace && typeof workspace === "object" && !Array.isArray(workspace)) {
      const currentDir = (workspace as Record<string, unknown>).current_dir;
      if (typeof currentDir === "string" && currentDir.trim() !== "") {
        cwd = currentDir;
      }
    }
    if (cwd === undefined && typeof obj.cwd === "string" && obj.cwd.trim() !== "") {
      cwd = obj.cwd;
    }

    const sessionId =
      typeof obj.session_id === "string" && obj.session_id.trim() !== ""
        ? obj.session_id
        : undefined;

    return { cwd, sessionId };
  } catch {
    return {};
  }
}

function composeStatusline(
  handoffLine: string | undefined,
  migrateNeeded: boolean,
): string | undefined {
  if (handoffLine) {
    return handoffLine;
  }
  if (migrateNeeded) {
    return MIGRATE_NOTICE;
  }
  return undefined;
}

/**
 * CLI entry for `grounder statusline` — Claude Code's `statusLine` command.
 * Unlike `handoff peek`, this text renders directly in the terminal on every
 * turn, so it must never crash, hang, or print more than a short line.
 * Silent by default: prints nothing and exits 0 when unlinked, empty, or on
 * any error (unless install schemas are stale — then a one-line migrate nudge).
 * @returns Always `0`.
 */
export async function runStatusline(argv: string[]): Promise<number> {
  const helpCode = helpExitCode(argv, "statusline");
  if (helpCode !== null) {
    return helpCode;
  }

  const input = await readStatuslineInput(process.stdin);
  return runStatuslineWithOptions({ cwd: input.cwd, sessionId: input.sessionId });
}

/**
 * Resolves the linked project and prints a one-line status for the newest
 * *usable* handoff, or nothing. Shares {@link resolveCurrentHandoffLabel} with
 * `grounder handoff peek` so both agree on which handoff is current.
 *
 * The handoff line only shows on the session's first render (see
 * {@link isFirstHandoffTeaserRender}) — a one-time "heads up", not a
 * permanent fixture. The migrate notice is not gated by this: `state.json` is
 * re-read fresh on every call, so it tracks reality live (e.g. it clears on
 * the next render after `grounder migrate` runs in another terminal).
 * Uses {@link resolveLinkedProject} directly (not `requireLinkedProject`) so failures stay silent.
 * @returns Always `0`.
 */
export async function runStatuslineWithOptions(options: StatuslineOptions = {}): Promise<number> {
  try {
    return await withHomeDir(options.homeDir, async () => {
      let handoffLine: string | undefined;
      try {
        const resolved = await resolveLinkedProject(options.cwd ?? process.cwd());
        if (resolved.ok) {
          const logsDir = resolveLogsDir(resolved.value.home, resolved.value.repo);
          const current = await resolveCurrentHandoffLabel(logsDir);
          if (current) {
            const shouldShow = options.sessionId
              ? await isFirstHandoffTeaserRender(options.sessionId, options.homeDir)
              : true;
            if (shouldShow) {
              handoffLine = `[grounder] handoff: "${current.label}" (${current.createdDate}) → /grounder-task`;
            }
          }
        }
      } catch {
        handoffLine = undefined;
      }

      const migrateNeeded = await schemaMigrateNeeded(options.homeDir);
      const line = composeStatusline(handoffLine, migrateNeeded);
      if (line !== undefined) {
        process.stdout.write(`${line}\n`);
      }
      return 0;
    });
  } catch {
    return 0;
  }
}
