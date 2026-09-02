import { withHomeDir } from "../connector/home.js";
import { type ResolveLinkedProjectResult, resolveLinkedProject } from "../connector/linked.js";
import { resolveLogsDir } from "../connector/vault.js";
import { helpExitCode } from "../help.js";
import { readStdinWithTimeout } from "../util/read-stdin.js";
import { resolveCurrentHandoffLabel } from "../vault/current-handoff.js";
import {
  hasHandoffTeaserBeenShown,
  markHandoffTeaserShown,
} from "./claude-statusline-teaser-state.js";
import { schemaMigrateNeeded } from "./schema-migrate-needed.js";

/** Max wait for Claude Code's statusLine JSON on stdin before giving up. */
const STDIN_TIMEOUT_MS = 200;

/** Options for {@link runStatuslineWithOptions} (CLI and tests). */
export interface StatuslineOptions {
  /** Directory used to find the linked repo (default: `process.cwd()`). */
  cwd?: string;
  /**
   * Fallback directory to retry with when `cwd` doesn't resolve to a linked
   * project — Claude Code's `workspace.project_dir` (where the session was
   * launched), used when `cwd`/`workspace.current_dir` has since wandered
   * outside the repo (e.g. the agent `cd`'d elsewhere). Only tried when it
   * differs from `cwd`.
   */
  projectDir?: string;
  /** Override home dir / `GROUNDER_HOME` (tests). */
  homeDir?: string;
  /**
   * Claude Code's stable per-session id (from stdin `session_id`). Gates the
   * handoff line to the session's first render — see
   * {@link hasHandoffTeaserBeenShown} / {@link markHandoffTeaserShown}. Omit
   * to always show (no suppression); the migrate notice is never gated by
   * this.
   */
  sessionId?: string;
}

const STATUSLINE_PREFIX = "[grounder]";
const MIGRATE_NOTICE_BODY = "install outdated — run: grounder migrate";

interface StatuslineStdinInput {
  cwd?: string;
  projectDir?: string;
  sessionId?: string;
}

/**
 * Read Claude Code's `statusLine` command payload from stdin: the workspace
 * directory/directories and session id, when present.
 *
 * Claude Code pipes JSON like `{ "cwd": "...", "session_id": "...",
 * "workspace": { "current_dir": "...", "project_dir": "..." } }`. Prefer
 * `workspace.current_dir` (live cwd, same value as top-level `cwd` per
 * Claude Code's docs) over top-level `cwd` as the primary lookup — a
 * monorepo subfolder resolves fine since `findLinkedRepoRoot` walks up.
 * `workspace.project_dir` ("directory where Claude Code was launched, which
 * may differ from `cwd` if the working directory changes during a session")
 * comes back separately as a fallback candidate for when the primary one no
 * longer points inside the linked repo at all — see
 * {@link runStatuslineWithOptions}.
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
    let projectDir: string | undefined;
    const workspace = obj.workspace;
    if (workspace && typeof workspace === "object" && !Array.isArray(workspace)) {
      const workspaceObj = workspace as Record<string, unknown>;
      const currentDir = workspaceObj.current_dir;
      if (typeof currentDir === "string" && currentDir.trim() !== "") {
        cwd = currentDir;
      }
      const dir = workspaceObj.project_dir;
      if (typeof dir === "string" && dir.trim() !== "") {
        projectDir = dir;
      }
    }
    if (cwd === undefined && typeof obj.cwd === "string" && obj.cwd.trim() !== "") {
      cwd = obj.cwd;
    }

    const sessionId =
      typeof obj.session_id === "string" && obj.session_id.trim() !== ""
        ? obj.session_id
        : undefined;

    return { cwd, projectDir, sessionId };
  } catch {
    return {};
  }
}

/**
 * Joins the handoff body and migrate notice under a single `[grounder]`
 * prefix — the bar is one line, so repeating the prefix per segment (as
 * `handoff peek`'s two-line teaser does) just eats width for no benefit.
 */
function composeStatusline(
  handoffBody: string | undefined,
  migrateNeeded: boolean,
): string | undefined {
  const parts = [handoffBody, migrateNeeded ? MIGRATE_NOTICE_BODY : undefined].filter(
    (part): part is string => part !== undefined,
  );
  if (parts.length === 0) {
    return undefined;
  }
  return `${STATUSLINE_PREFIX} ${parts.join(" · ")}`;
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
  return runStatuslineWithOptions({
    cwd: input.cwd,
    projectDir: input.projectDir,
    sessionId: input.sessionId,
  });
}

/**
 * Resolve the linked project from `cwd`, retrying with `projectDir` (Claude
 * Code's `workspace.project_dir` — where the session was launched) when
 * `cwd` doesn't resolve and the two differ. `cwd` can wander outside the
 * repo mid-session (the agent `cd`'d elsewhere, `/add-dir`, …); `project_dir`
 * stays pinned to the actual project, so it's a better last resort than
 * giving up.
 */
async function resolveLinkedProjectWithFallback(
  cwd: string,
  projectDir: string | undefined,
): Promise<ResolveLinkedProjectResult> {
  const resolved = await resolveLinkedProject(cwd);
  if (resolved.ok || projectDir === undefined || projectDir === cwd) {
    return resolved;
  }
  return resolveLinkedProject(projectDir);
}

/**
 * Resolves the linked project and prints a one-line status for the newest
 * *usable* handoff, or nothing. Shares {@link resolveCurrentHandoffLabel} with
 * `grounder handoff peek` so both agree on which handoff is current.
 *
 * The handoff line only shows on the session's first render — a one-time
 * "heads up", not a permanent fixture. The "already shown?" check ({@link
 * hasHandoffTeaserBeenShown}) runs *before* resolving the project/vault, so
 * an already-shown render skips that I/O entirely; the session is marked
 * shown ({@link markHandoffTeaserShown}) only *after* the line has actually
 * reached stdout, not before resolving/printing it. That ordering matters:
 * Claude Code aborts an in-flight `statusLine` process when a newer refresh
 * starts, discarding its stdout, and overlapping spawns are expected at
 * session start — marking up front would let an aborted spawn's marker
 * consume the one render the user would have actually seen, so the teaser
 * could silently never appear (see {@link markHandoffTeaserShown}'s
 * docstring for the full race).
 * The migrate notice is not gated by this: `state.json` is re-read fresh on
 * every call, so it tracks reality live (e.g. it clears on the next render
 * after `grounder migrate` runs in another terminal).
 * Uses {@link resolveLinkedProjectWithFallback} (not `requireLinkedProject`) so failures stay silent.
 * @returns Always `0`.
 */
export async function runStatuslineWithOptions(options: StatuslineOptions = {}): Promise<number> {
  try {
    return await withHomeDir(options.homeDir, async () => {
      let handoffLine: string | undefined;
      const shouldCheckHandoff = options.sessionId
        ? !(await hasHandoffTeaserBeenShown(options.sessionId, options.homeDir))
        : true;
      if (shouldCheckHandoff) {
        try {
          const resolved = await resolveLinkedProjectWithFallback(
            options.cwd ?? process.cwd(),
            options.projectDir,
          );
          if (resolved.ok) {
            const logsDir = resolveLogsDir(resolved.value.home, resolved.value.repo);
            const current = await resolveCurrentHandoffLabel(logsDir);
            if (current) {
              handoffLine = `handoff: "${current.label}" (${current.createdDate}) → /grounder-task`;
            }
          }
        } catch {
          handoffLine = undefined;
        }
      }

      const migrateNeeded = await schemaMigrateNeeded(options.homeDir);
      const line = composeStatusline(handoffLine, migrateNeeded);
      if (line !== undefined) {
        // `write()` returning doesn't confirm Claude Code accepted the bytes
        // — if it aborts this process right after this line, the marker
        // below still gets written and the teaser is lost for this session
        // (same fail-open trade-off as the abort-before-write race described
        // on markHandoffTeaserShown; just narrower, since the window here is
        // only the gap between write() returning and the process actually
        // exiting). Not worth chasing for a ~100-byte line.
        process.stdout.write(`${line}\n`);
      }
      if (handoffLine !== undefined && options.sessionId !== undefined) {
        await markHandoffTeaserShown(options.sessionId, options.homeDir);
      }
      return 0;
    });
  } catch {
    return 0;
  }
}
