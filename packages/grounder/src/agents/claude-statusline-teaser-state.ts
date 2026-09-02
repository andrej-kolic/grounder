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
 * True when `sessionId`'s handoff teaser has already been marked shown.
 * Read-only — never marks a session as seen. Callers must call
 * {@link markHandoffTeaserShown} themselves, and only once the teaser has
 * actually reached stdout (see that function's docstring for why this is
 * split in two instead of one check-and-mark call).
 *
 * When a marker exists, its mtime is refreshed on every call instead of left
 * untouched — otherwise a session left open (or resumed) past
 * {@link MARKER_MAX_AGE_MS} would have its own marker swept by
 * {@link pruneStaleMarkers} and the teaser would reappear mid-session, which
 * contradicts "stays suppressed across a resume" (docs/session-hooks.md).
 * The refresh is a plain `utimes`, not a full prune pass, so a hot "already
 * shown" call stays cheap. This refresh is a liveness signal only — it does
 * not affect what this call returns.
 *
 * A `sessionId` outside {@link SAFE_SESSION_ID} never touches disk and always
 * reports "not shown" — treated like a filesystem error (see below).
 *
 * Never throws. On any filesystem error, returns `false` ("not shown yet") —
 * favors an extra render of the teaser over a permanently stuck "never shows
 * again".
 */
export async function hasHandoffTeaserBeenShown(
  sessionId: string,
  homeDir?: string,
): Promise<boolean> {
  if (!isSafeSessionId(sessionId)) {
    return false;
  }

  const file = path.join(seenDir(homeDir), sessionId);
  try {
    const now = new Date();
    await utimes(file, now, now);
    return true;
  } catch {
    return false;
  }
}

/**
 * Marks `sessionId`'s handoff teaser as shown (atomic create-exclusive
 * write), so a later {@link hasHandoffTeaserBeenShown} call returns `true`.
 *
 * Call this *only* after the handoff line has actually reached stdout — not
 * before resolving or printing it. Claude Code aborts an in-flight
 * `statusLine` process when a newer refresh starts (overlapping spawns are
 * expected at session start), and an aborted process's stdout is discarded.
 * Marking up front (the previous behavior, check-and-mark in one call) let an
 * aborted spawn's marker consume the one render the user would have actually
 * seen: the next spawn would see "already shown" and print nothing, so the
 * teaser could vanish without the user ever seeing it, with no way back
 * (`--resume` reuses the same `session_id`). Marking only after a successful
 * write means an aborted spawn simply never marks, and the next spawn tries
 * again — the earlier `hasHandoffTeaserBeenShown` docstring's "favor an extra
 * render" guarantee actually holds.
 *
 * Best-effort and idempotent: a concurrent duplicate write (two spawns both
 * printing the line before either marks) just means the teaser rendered
 * twice — the accepted fail-open trade-off, not an error.
 *
 * A `sessionId` outside {@link SAFE_SESSION_ID} never touches disk.
 *
 * Never throws.
 */
export async function markHandoffTeaserShown(sessionId: string, homeDir?: string): Promise<void> {
  if (!isSafeSessionId(sessionId)) {
    return;
  }

  const dir = seenDir(homeDir);
  const file = path.join(dir, sessionId);
  try {
    await mkdir(dir, { recursive: true });
    await pruneStaleMarkers(dir);
    await writeFile(file, "", { flag: "wx" });
  } catch {
    // EEXIST (already marked, e.g. a concurrent spawn) or any other
    // filesystem error — best-effort, safe to ignore either way.
  }
}
