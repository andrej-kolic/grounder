import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHomeDir } from "../connector/home.js";
import { fileExists } from "../util/fs.js";
import { mergeJsonFile } from "../util/merge-json.js";
import {
  installHookRuntime,
  isGrounderPeekHookCommand,
  isHookRuntimeStale,
  peekHookCommand,
} from "./hook-runtime.js";
import { installCommandFile, recordCommandFileHashes } from "./install-command.js";
import type {
  AgentAdapter,
  AgentInstallOptions,
  AgentInstallResult,
  ArtifactStatus,
} from "./types.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const templateDir = path.join(pkgRoot, "templates", "agents", "claude", "skills");

const SKILLS = [
  "grounder-note",
  "grounder-search",
  "grounder-plan",
  "grounder-task-handoff",
  "grounder-task",
] as const;

const COMMANDS = SKILLS.map((name) => path.join(name, "SKILL.md"));

/**
 * Canonical SessionStart command for Claude Code (home-local runtime, not `npx`).
 * @see {@link peekHookCommand} — REVERT: restore `"npx grounder handoff peek"` and drop runtime.
 */
export function claudePeekHookCommand(homeDir?: string): string {
  return peekHookCommand(homeDir);
}

/**
 * SessionStart matcher Grounder owns.
 * Excludes `resume` and `fork` — those sessions already carry prior context.
 */
export const CLAUDE_SESSION_START_MATCHER = "startup|clear|compact";

export function claudeSkillsDir(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".claude", "skills");
}

/** Absolute path to Claude Code's shared settings file (`~/.claude/settings.json`). */
export function claudeSettingsJsonPath(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".claude", "settings.json");
}

export function grounderNoteCommandPath(homeDir?: string): string {
  return path.join(claudeSkillsDir(homeDir), "grounder-note", "SKILL.md");
}

export function grounderPlanCommandPath(homeDir?: string): string {
  return path.join(claudeSkillsDir(homeDir), "grounder-plan", "SKILL.md");
}

export function grounderTaskHandoffCommandPath(homeDir?: string): string {
  return path.join(claudeSkillsDir(homeDir), "grounder-task-handoff", "SKILL.md");
}

export function grounderTaskCommandPath(homeDir?: string): string {
  return path.join(claudeSkillsDir(homeDir), "grounder-task", "SKILL.md");
}

export function expectedArtifacts(homeDir?: string): string[] {
  return COMMANDS.map((filename) => path.join(claudeSkillsDir(homeDir), filename));
}

/** Paths of hook config this adapter touches — currently just `settings.json`. */
export function expectedHookArtifacts(homeDir?: string): string[] {
  return [claudeSettingsJsonPath(homeDir)];
}

// ---------------------------------------------------------------------------
// Session-start hook install (~/.claude/settings.json)
//
// Claude Code settings are a shared JSON object. Grounder only owns one nested
// command entry; unrelated keys (permissions, other hook events, etc.) must
// survive merge. Relevant shape after install (path varies by home / Node):
//
//   {
//     "hooks": {
//       "SessionStart": [
//         {
//           "matcher": "startup|clear|compact",
//           "hooks": [
//             {
//               "type": "command",
//               "command": "'/path/to/node' '/path/to/.grounder/runtime/dist/cli.js' handoff peek"
//             }
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
// Idempotency: {@link isGrounderPeekHookCommand} (runtime path or legacy npx).
// ---------------------------------------------------------------------------

function peekHookEntry(homeDir?: string): { type: "command"; command: string } {
  return { type: "command", command: claudePeekHookCommand(homeDir) };
}

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
        isGrounderPeekHookCommand((hook as { command?: unknown }).command)
      ) {
        return { groupIdx, hookIdx };
      }
    }
  }
  return null;
}

/** Whether `settings.json` already lists any Grounder peek command (for status labeling). */
async function peekHookHadGrounderEntry(filePath: string): Promise<boolean> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    const hooks = (parsed as Record<string, unknown>).hooks;
    if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
      return false;
    }
    const sessionStart = (hooks as Record<string, unknown>).SessionStart;
    return Array.isArray(sessionStart) && findPeekHook(sessionStart) !== null;
  } catch {
    return false;
  }
}

/**
 * Skip only when the canonical command is already present *and* the runtime is
 * current for the running grounder version/source. Legacy `npx` entries or a
 * stale runtime (missing, or symlinked/copied from a different source) always
 * refresh — no `--force` required to migrate or to pick up an upgrade.
 */
async function peekHookUpToDate(filePath: string, homeDir?: string): Promise<boolean> {
  if (!(await fileExists(filePath))) {
    return false;
  }
  if (await isHookRuntimeStale(homeDir)) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    const hooks = (parsed as Record<string, unknown>).hooks;
    if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
      return false;
    }
    const sessionStart = (hooks as Record<string, unknown>).SessionStart;
    if (!Array.isArray(sessionStart)) {
      return false;
    }
    const found = findPeekHook(sessionStart);
    if (!found) {
      return false;
    }
    const group = sessionStart[found.groupIdx] as { hooks: Array<{ command?: unknown }> };
    return group.hooks[found.hookIdx]?.command === claudePeekHookCommand(homeDir);
  } catch {
    return false;
  }
}

/**
 * Deep-merge Grounder's SessionStart hook into an existing settings object.
 *
 * Preserves every key except the nested path it owns. Strategy:
 * 1. If a Grounder peek hook already exists (runtime or legacy npx) → replace in place.
 * 2. Else if a matcher group with `matcher === CLAUDE_SESSION_START_MATCHER` exists →
 *    append Grounder's hook to that group's `hooks` array.
 * 3. Else → push a new matcher group with Grounder's hook.
 *
 * @param current - Parsed settings.json root (object). Other top-level keys untouched.
 * @param homeDir - Home override for the canonical command path
 * @returns New settings object with `hooks.SessionStart` updated
 */
function mergeClaudeHooks(
  current: Record<string, unknown>,
  homeDir?: string,
): Record<string, unknown> {
  const hooks =
    current.hooks && typeof current.hooks === "object" && !Array.isArray(current.hooks)
      ? { ...(current.hooks as Record<string, unknown>) }
      : {};
  const sessionStart = Array.isArray(hooks.SessionStart) ? [...hooks.SessionStart] : [];
  const found = findPeekHook(sessionStart);
  const entry = peekHookEntry(homeDir);

  if (found) {
    // Path 1: refresh existing Grounder hook entry in place
    const group = { ...(sessionStart[found.groupIdx] as Record<string, unknown>) };
    const groupHooks = Array.isArray(group.hooks) ? [...group.hooks] : [];
    groupHooks[found.hookIdx] = entry;
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
      groupHooks.push(entry);
      group.hooks = groupHooks;
      sessionStart[matcherIdx] = group;
    } else {
      // Path 3: no matching group — create the canonical SessionStart entry
      sessionStart.push({
        matcher: CLAUDE_SESSION_START_MATCHER,
        hooks: [entry],
      });
    }
  }

  return { ...current, hooks: { ...hooks, SessionStart: sessionStart } };
}

/**
 * Install (or refresh) Grounder's SessionStart teaser hook into `~/.claude/settings.json`.
 *
 * Also materializes `~/.grounder/runtime` (see {@link installHookRuntime}).
 *
 * Force semantics:
 * - Up-to-date canonical entry + fresh runtime and `force` false → skip
 * - Otherwise → refresh runtime + merge host config
 *
 * Unparseable settings.json: {@link mergeJsonFile} backs off and this throws (never clobbers).
 */
async function installHooks(opts: AgentInstallOptions): Promise<AgentInstallResult> {
  const dest = claudeSettingsJsonPath(opts.homeDir);
  const upToDate = await peekHookUpToDate(dest, opts.homeDir);

  if (upToDate && !opts.force) {
    return { artifacts: { [dest]: "skipped" } };
  }

  if (opts.dryRun) {
    const fileExisted = await fileExists(dest);
    const hadGrounderEntry = fileExisted && (await peekHookHadGrounderEntry(dest));
    const status: ArtifactStatus = hadGrounderEntry ? "overwritten" : "created";
    return { artifacts: { [dest]: status } };
  }

  await installHookRuntime({ homeDir: opts.homeDir });
  const fileExisted = await fileExists(dest);
  const hadGrounderEntry = fileExisted && (await peekHookHadGrounderEntry(dest));
  const result = await mergeJsonFile(dest, (current) => mergeClaudeHooks(current, opts.homeDir));

  if (!result.ok) {
    throw new Error(result.message);
  }

  const status: ArtifactStatus = hadGrounderEntry ? "overwritten" : "created";
  return { artifacts: { [dest]: status } };
}

export const claude: AgentAdapter = {
  id: "claude",
  name: "Claude Code",
  commandsSchema: 4,
  hooksSchema: 1,

  async isInstalled(): Promise<boolean> {
    return fileExists(path.join(resolveHomeDir(), ".claude"));
  },

  expectedArtifacts,
  expectedHookArtifacts,

  async install(opts: AgentInstallOptions): Promise<AgentInstallResult> {
    const artifacts: Record<string, ArtifactStatus> = {};
    const files: Record<string, { hash: string }> = {};
    for (const filename of COMMANDS) {
      const { dest, status, hash } = await installCommandFile({
        ...opts,
        agentId: claude.id,
        templateDir,
        commandsDir: claudeSkillsDir(opts.homeDir),
        filename,
      });
      artifacts[dest] = status;
      if (hash) {
        files[dest] = { hash };
      }
    }
    await recordCommandFileHashes({
      agentId: claude.id,
      commandsSchema: claude.commandsSchema,
      files,
      homeDir: opts.homeDir,
      dryRun: opts.dryRun,
    });
    return { artifacts };
  },

  installHooks,
};
