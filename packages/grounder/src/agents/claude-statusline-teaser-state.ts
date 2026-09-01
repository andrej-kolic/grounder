import { mkdir, readdir, stat, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveHomeDir } from "../connector/home.js";

/**
 * Session-scoped "have we shown the handoff teaser yet" marker for `grounder
 * statusline`.
 *
 * The handoff teaser is meant as a one-time "heads up" at session start, not
 * a permanent fixture — it should disappear once you've started actually
 * working (in practice: after your first prompt, since `statusLine` only
 * re-renders on a new assistant message or similar events, and the very
 * first render happens before you've typed anything).
 *
 * Each `statusline` invocation is a fresh process with no memory of prior
 * calls, so "already shown" has to be persisted. Claude Code's `session_id`
 * (stable for the session's lifetime, including ordinary `--resume`/
 * `--continue` — see CLI help: those reuse the same id unless
 * `--fork-session` is passed) gives a natural key: one empty marker file per
 * session, created atomically on first render.
 *
 * This is disposable UI state, not durable install data — kept separate from
 * `~/.grounder/state.json` and swept by age on every check so it never grows
 * unbounded on a long-uptime machine.
 *
 * Nested under an agent id (matching how `~/.grounder/state.json` keys
 * `agents.claude` / `agents.cursor`) since `statusLine` is a Claude Code
 * concept — a future per-agent equivalent for another agent gets its own
 * subtree instead of mixing unrelated session-id schemes in one directory.
 */

/** Marker files older than this are pruned opportunistically on every check. */
const MARKER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * `session_id` becomes a filename (`seenDir()/<sessionId>`) with no further
 * escaping, so it's constrained to a safe charset before it ever touches
 * disk — no `/`, and not the literal `.`/`..` (which `path.join` would
 * resolve outside `seenDir()` even without a slash). Claude Code's ids are
 * UUIDs, well inside this, but the value arrives over stdin so it's treated
 * as untrusted.
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/;

function isSafeSessionId(sessionId: string): boolean {
  return SAFE_SESSION_ID.test(sessionId);
}

/**
 * Mirrors `claude.id` in `agents/claude.ts` — kept as a literal (not imported)
 * to avoid pulling that module's install logic into every `statusline` run.
 * Exported so a test can assert it stays in sync.
 */
export const CLAUDE_AGENT_ID = "claude";

function seenDir(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".grounder", "tmp", CLAUDE_AGENT_ID, "statusline-seen");
}

/** Best-effort: delete markers older than {@link MARKER_MAX_AGE_MS}. Never throws. */
async function pruneStaleMarkers(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const now = Date.now();
  await Promise.all(
    entries.map(async (name) => {
      const file = path.join(dir, name);
      try {
        const info = await stat(file);
        if (now - info.mtimeMs > MARKER_MAX_AGE_MS) {
          await unlink(file);
        }
      } catch {
        // Raced with another process removing it, or a permissions blip — fine,
        // this is disposable cache state.
      }
    }),
  );
}

/**
 * True when this is the *first* `statusline` render for `sessionId` — i.e.
 * the handoff teaser should show now. Marks the session as seen as a side
 * effect (atomic create-exclusive write), so every later call for the same
 * `sessionId` returns `false`.
 *
 * When the marker already exists, its mtime is refreshed on every call
 * instead of left untouched — otherwise a session left open (or resumed)
 * past {@link MARKER_MAX_AGE_MS} would have its own marker swept by
 * {@link pruneStaleMarkers} and the teaser would reappear mid-session, which
 * contradicts "stays suppressed across a resume" (docs/session-hooks.md).
 * The refresh is a plain `utimes`, not a full prune pass, so a hot "already
 * seen" call stays cheap.
 *
 * A `sessionId` outside {@link SAFE_SESSION_ID} never touches disk — it's
 * treated like a filesystem error (see below).
 *
 * Never throws. On any filesystem error, returns `true` (show it) — favors
 * an extra render of the teaser over a permanently stuck "never shows again".
 */
export async function isFirstHandoffTeaserRender(
  sessionId: string,
  homeDir?: string,
): Promise<boolean> {
  if (!isSafeSessionId(sessionId)) {
    return true;
  }

  const dir = seenDir(homeDir);
  const file = path.join(dir, sessionId);
  try {
    await mkdir(dir, { recursive: true });

    try {
      const now = new Date();
      await utimes(file, now, now);
      return false;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }

    await pruneStaleMarkers(dir);
    await writeFile(file, "", { flag: "wx" });
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "EEXIST";
  }
}
