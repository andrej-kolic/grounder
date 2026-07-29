import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHomeDir } from "../connector/home.js";
import { fileExists } from "../util/fs.js";
import { mergeJsonFile } from "../util/merge-json.js";
import type {
  AgentAdapter,
  AgentInstallOptions,
  AgentInstallResult,
  ArtifactStatus,
} from "./types.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const templateDir = path.join(pkgRoot, "templates", "agents", "claude", "commands");

const COMMANDS = ["grounder-note.md", "grounder-task-handoff.md", "grounder-task.md"] as const;

/**
 * Command string written into Claude Code's SessionStart hook entry.
 * Used as the idempotency key when scanning/merging `hooks.SessionStart`.
 */
export const CLAUDE_PEEK_HOOK_COMMAND = "npx grounder handoff peek";

/**
 * SessionStart matcher Grounder owns.
 * Excludes `resume` and `fork` — those sessions already carry prior context.
 */
export const CLAUDE_SESSION_START_MATCHER = "startup|clear|compact";

/**
 * Canonical hook object Grounder installs under a SessionStart matcher group.
 *
 * @see {@link mergeClaudeHooks} for the surrounding `~/.claude/settings.json` shape
 */
const PEEK_HOOK = {
  type: "command",
  command: CLAUDE_PEEK_HOOK_COMMAND,
} as const;

export function claudeCommandsDir(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".claude", "commands");
}

/** Absolute path to Claude Code's shared settings file (`~/.claude/settings.json`). */
export function claudeSettingsJsonPath(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".claude", "settings.json");
}

export function grounderNoteCommandPath(homeDir?: string): string {
  return path.join(claudeCommandsDir(homeDir), "grounder-note.md");
}

export function grounderTaskHandoffCommandPath(homeDir?: string): string {
  return path.join(claudeCommandsDir(homeDir), "grounder-task-handoff.md");
}

export function grounderTaskCommandPath(homeDir?: string): string {
  return path.join(claudeCommandsDir(homeDir), "grounder-task.md");
}

export function expectedArtifacts(homeDir?: string): string[] {
  return COMMANDS.map((filename) => path.join(claudeCommandsDir(homeDir), filename));
}

/** Paths of hook config this adapter touches — currently just `settings.json`. */
export function expectedHookArtifacts(homeDir?: string): string[] {
  return [claudeSettingsJsonPath(homeDir)];
}

async function installCommand(
  filename: (typeof COMMANDS)[number],
  opts: AgentInstallOptions,
): Promise<{ dest: string; status: ArtifactStatus }> {
  const dest = path.join(claudeCommandsDir(opts.homeDir), filename);
  const existed = await fileExists(dest);

  if (existed && !opts.force) {
    return { dest, status: "skipped" };
  }

  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(path.join(templateDir, filename), dest);
  return { dest, status: existed ? "overwritten" : "created" };
}

// ---------------------------------------------------------------------------
// Session-start hook install (~/.claude/settings.json)
//
// Claude Code settings are a shared JSON object. Grounder only owns one nested
// command entry; unrelated keys (permissions, other hook events, etc.) must
// survive merge. Relevant shape after install:
//
//   {
//     "hooks": {
//       "SessionStart": [
//         {
//           "matcher": "startup|clear|compact",
//           "hooks": [
//             { "type": "command", "command": "npx grounder handoff peek" }
//           ]
//         }
//       ]
//     }
//   }
//
// Terminology used below:
//   - settings root      → the whole settings.json object
//   - hooks              → settings.hooks (map of event name → matcher groups)
//   - SessionStart       → hooks.SessionStart (array of matcher groups)
//   - matcher group      → { matcher, hooks: Hook[] }
//   - hook entry         → { type: "command", command: string }
//
// Idempotency: locate Grounder's entry by matching `command === CLAUDE_PEEK_HOOK_COMMAND`
// anywhere under SessionStart (not by matcher string alone).
// ---------------------------------------------------------------------------

/**
 * Locate Grounder's peek command inside a `hooks.SessionStart` array.
 *
 * @param sessionStart - `settings.hooks.SessionStart` — array of matcher groups
 * @returns Indices into that array / the group's `hooks` array, or `null` if absent
 */
function findPeekHook(sessionStart: unknown[]): { groupIdx: number; hookIdx: number } | null {
  for (let groupIdx = 0; groupIdx < sessionStart.length; groupIdx++) {
    const group = sessionStart[groupIdx];
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      continue;
    }
    const hooks = (group as { hooks?: unknown }).hooks;
    if (!Array.isArray(hooks)) {
      continue;
    }
    for (let hookIdx = 0; hookIdx < hooks.length; hookIdx++) {
      const hook = hooks[hookIdx];
      if (
        hook &&
        typeof hook === "object" &&
        !Array.isArray(hook) &&
        (hook as { command?: unknown }).command === CLAUDE_PEEK_HOOK_COMMAND
      ) {
        return { groupIdx, hookIdx };
      }
    }
  }
  return null;
}

/**
 * @param hooks - `settings.hooks` object (may be missing or malformed)
 * @returns Whether any SessionStart matcher group already contains Grounder's command
 */
function sessionStartHasPeekCommand(hooks: unknown): boolean {
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    return false;
  }
  const sessionStart = (hooks as Record<string, unknown>).SessionStart;
  if (!Array.isArray(sessionStart)) {
    return false;
  }
  return findPeekHook(sessionStart) !== null;
}

/**
 * Read `settings.json` and report whether Grounder's SessionStart hook is present.
 * Parse / shape failures return `false` (caller may still attempt merge, which backs off).
 */
async function peekHookAlreadyInstalled(filePath: string): Promise<boolean> {
  if (!(await fileExists(filePath))) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    return sessionStartHasPeekCommand((parsed as Record<string, unknown>).hooks);
  } catch {
    return false;
  }
}

/**
 * Deep-merge Grounder's SessionStart hook into an existing settings object.
 *
 * Preserves every key except the nested path it owns. Strategy:
 * 1. If a hook with `command === CLAUDE_PEEK_HOOK_COMMAND` already exists → replace
 *    that hook entry in place (refresh to the canonical `{ type, command }` shape).
 * 2. Else if a matcher group with `matcher === CLAUDE_SESSION_START_MATCHER` exists →
 *    append Grounder's hook to that group's `hooks` array.
 * 3. Else → push a new matcher group with Grounder's hook.
 *
 * @param current - Parsed settings.json root (object). Other top-level keys untouched.
 * @returns New settings object with `hooks.SessionStart` updated
 */
function mergeClaudeHooks(current: Record<string, unknown>): Record<string, unknown> {
  const hooks =
    current.hooks && typeof current.hooks === "object" && !Array.isArray(current.hooks)
      ? { ...(current.hooks as Record<string, unknown>) }
      : {};
  const sessionStart = Array.isArray(hooks.SessionStart) ? [...hooks.SessionStart] : [];
  const found = findPeekHook(sessionStart);

  if (found) {
    // Path 1: refresh existing Grounder hook entry in place
    const group = { ...(sessionStart[found.groupIdx] as Record<string, unknown>) };
    const groupHooks = Array.isArray(group.hooks) ? [...group.hooks] : [];
    groupHooks[found.hookIdx] = { ...PEEK_HOOK };
    group.hooks = groupHooks;
    sessionStart[found.groupIdx] = group;
  } else {
    const matcherIdx = sessionStart.findIndex(
      (group) =>
        group &&
        typeof group === "object" &&
        !Array.isArray(group) &&
        (group as { matcher?: unknown }).matcher === CLAUDE_SESSION_START_MATCHER,
    );
    if (matcherIdx >= 0) {
      // Path 2: same matcher group already exists (e.g. user hooks) — append ours
      const group = { ...(sessionStart[matcherIdx] as Record<string, unknown>) };
      const groupHooks = Array.isArray(group.hooks) ? [...group.hooks] : [];
      groupHooks.push({ ...PEEK_HOOK });
      group.hooks = groupHooks;
      sessionStart[matcherIdx] = group;
    } else {
      // Path 3: no matching group — create the canonical SessionStart entry
      sessionStart.push({
        matcher: CLAUDE_SESSION_START_MATCHER,
        hooks: [{ ...PEEK_HOOK }],
      });
    }
  }

  return { ...current, hooks: { ...hooks, SessionStart: sessionStart } };
}

/**
 * Install (or refresh) Grounder's SessionStart teaser hook into `~/.claude/settings.json`.
 *
 * Force semantics match slash-command install:
 * - Grounder entry missing → merge in, status `created`
 * - Grounder entry present and `force` false → leave file untouched, status `skipped`
 * - Grounder entry present and `force` true → re-merge canonical entry, status `overwritten`
 *
 * Unparseable settings.json: {@link mergeJsonFile} backs off and this throws (never clobbers).
 */
async function installHooks(opts: AgentInstallOptions): Promise<AgentInstallResult> {
  const dest = claudeSettingsJsonPath(opts.homeDir);
  const alreadyHas = await peekHookAlreadyInstalled(dest);

  if (alreadyHas && !opts.force) {
    return { artifacts: { [dest]: "skipped" } };
  }

  const result = await mergeJsonFile(dest, mergeClaudeHooks);

  if (!result.ok) {
    throw new Error(result.message);
  }

  const status: ArtifactStatus = alreadyHas ? "overwritten" : "created";
  return { artifacts: { [dest]: status } };
}

export const claude: AgentAdapter = {
  id: "claude",
  name: "Claude Code",

  async isInstalled(): Promise<boolean> {
    return fileExists(path.join(resolveHomeDir(), ".claude"));
  },

  expectedArtifacts,
  expectedHookArtifacts,

  async install(opts: AgentInstallOptions): Promise<AgentInstallResult> {
    const artifacts: Record<string, ArtifactStatus> = {};
    for (const filename of COMMANDS) {
      const { dest, status } = await installCommand(filename, opts);
      artifacts[dest] = status;
    }
    return { artifacts };
  },

  installHooks,
};
