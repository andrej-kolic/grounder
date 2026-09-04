import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHomeDir } from "../connector/home.js";
import { fileExists } from "../util/fs.js";
import { mergeJsonFile } from "../util/merge-json.js";
import { readHooksObject, removeMatchingEntries } from "./hook-fragment.js";
import {
  installHookRuntime,
  isGrounderPeekHookCommand,
  isHookRuntimeStale,
  peekHookCommand,
  runtimeInvocation,
} from "./hook-runtime.js";
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
 * Frozen historical fact about the schema-3 (pre-skill) install layout —
 * deliberately hardcoded, not derived from {@link expectedArtifacts} (which
 * describes today's Agent Skills layout). Safe to delete once schema-3
 * installs are assumed extinct in the wild — a maintainer call, not
 * something to automate via a version check.
 */
const LEGACY_COMMAND_FILENAMES = [
  "grounder-note.md",
  "grounder-search.md",
  "grounder-plan.md",
  "grounder-task-handoff.md",
  "grounder-task.md",
] as const;

function legacyCommandsDir(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".claude", "commands");
}

/**
 * Canonical SessionStart command for Claude Code (home-local runtime, not `npx`).
 * @see {@link peekHookCommand}
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
// Idempotency / recognizer: {@link isGrounderPeekHookCommand} (runtime path
// or legacy npx). Always-converge (Ansible `blockinfile` / Kubernetes
// Server-Side Apply sole-owner model): every recognizer match — however many,
// wherever they live across matcher groups — is removed and replaced with
// exactly one canonical entry. No conflict / `--force` gate.
// ---------------------------------------------------------------------------

function peekHookEntry(homeDir?: string): { type: "command"; command: string } {
  return { type: "command", command: claudePeekHookCommand(homeDir) };
}

function isClaudeHookEntry(hook: unknown): hook is { type: "command"; command: string } {
  return (
    hook !== null &&
    typeof hook === "object" &&
    !Array.isArray(hook) &&
    (hook as { type?: unknown }).type === "command" &&
    isGrounderPeekHookCommand((hook as { command?: unknown }).command)
  );
}

function isMatcherGroup(group: unknown): group is Record<string, unknown> {
  return group !== null && typeof group === "object" && !Array.isArray(group);
}

/** One Grounder hook entry plus the matcher group it was found under. */
interface PlacedPeekHook {
  matcher: unknown;
  hook: unknown;
}

/** Every Grounder hook entry across every matcher group, tagged with its group's matcher. */
function findAllPeekHooksPlaced(sessionStart: readonly unknown[]): PlacedPeekHook[] {
  const found: PlacedPeekHook[] = [];
  for (const group of sessionStart) {
    if (!isMatcherGroup(group) || !Array.isArray(group.hooks)) {
      continue;
    }
    for (const hook of group.hooks.filter(isClaudeHookEntry)) {
      found.push({ matcher: group.matcher, hook });
    }
  }
  return found;
}

/** Every Grounder hook entry across every matcher group, flattened. */
function findAllPeekHooks(sessionStart: readonly unknown[]): unknown[] {
  return findAllPeekHooksPlaced(sessionStart).map((placed) => placed.hook);
}

/** Remove every Grounder hook entry from every matcher group's `hooks` array. */
function removeAllPeekHooks(sessionStart: readonly unknown[]): unknown[] {
  return sessionStart.map((group) => {
    if (!isMatcherGroup(group) || !Array.isArray(group.hooks)) {
      return group;
    }
    return { ...group, hooks: removeMatchingEntries(group.hooks, isClaudeHookEntry) };
  });
}

function hasHooks(group: unknown): boolean {
  return isMatcherGroup(group) && Array.isArray(group.hooks) && group.hooks.length > 0;
}

/**
 * Drop matcher groups that removal itself emptied — i.e. `next[i]` has no
 * hooks left but `before[i]` (same index, pre-removal) did. A group that was
 * already empty for reasons of its own (not something Grounder touched) is
 * left alone: it isn't clutter Grounder created room for, so it isn't
 * Grounder's call to delete it. `next` may be longer than `before` (a newly
 * appended canonical group) — those extra entries always have hooks, so the
 * length mismatch never reaches the `before[i]` lookup.
 */
function dropGroupsEmptiedByRemoval(
  before: readonly unknown[],
  next: readonly unknown[],
): unknown[] {
  return next.filter((group, i) => hasHooks(group) || !hasHooks(before[i]));
}

function readSessionStart(parsed: unknown): unknown[] | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const hooks = (parsed as Record<string, unknown>).hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    return null;
  }
  const sessionStart = (hooks as Record<string, unknown>).SessionStart;
  return Array.isArray(sessionStart) ? sessionStart : null;
}

/** Whether `settings.json` already lists any Grounder peek command (for status labeling). */
async function peekHookHadGrounderEntry(filePath: string): Promise<boolean> {
  try {
    const sessionStart = readSessionStart(JSON.parse(await readFile(filePath, "utf8")));
    return (sessionStart ? findAllPeekHooks(sessionStart) : []).length > 0;
  } catch {
    return false;
  }
}

/**
 * Skip only when exactly one canonical entry is already present *under the
 * canonical matcher group* ({@link CLAUDE_SESSION_START_MATCHER}) *and* the
 * runtime is current for the running grounder version/source. Anything else
 * — no entry, a legacy `npx` form, a drifted command, more than one match
 * (however scattered across matcher groups), or the one match sitting under
 * the wrong matcher — always converges.
 */
async function peekHookUpToDate(filePath: string, homeDir?: string): Promise<boolean> {
  if (!(await fileExists(filePath))) {
    return false;
  }
  if (await isHookRuntimeStale(homeDir)) {
    return false;
  }
  try {
    const sessionStart = readSessionStart(JSON.parse(await readFile(filePath, "utf8")));
    if (!sessionStart) {
      return false;
    }
    const placed = findAllPeekHooksPlaced(sessionStart);
    if (placed.length !== 1 || placed[0].matcher !== CLAUDE_SESSION_START_MATCHER) {
      return false;
    }
    return JSON.stringify(placed[0].hook) === JSON.stringify(peekHookEntry(homeDir));
  } catch {
    return false;
  }
}

/**
 * Converge Grounder's SessionStart hook into an existing settings object:
 * remove every recognizer match from every matcher group, then insert
 * exactly one canonical entry.
 *
 * Preserves every key except the nested path it owns. Insertion strategy
 * (after removal, so this always runs against a Grounder-free tree):
 * 1. A matcher group with `matcher === CLAUDE_SESSION_START_MATCHER` exists
 *    (possibly the very one a match was just removed from) → append there.
 * 2. Else → push a new matcher group with Grounder's hook.
 *
 * Any matcher group the removal step emptied — e.g. a Grounder-only hook
 * that lived under a non-canonical matcher — is dropped rather than left
 * behind as clutter, matching {@link removeClaudeHooks}'s uninstall path.
 *
 * @param current - Parsed settings.json root (object). Other top-level keys untouched.
 * @param homeDir - Home override for the canonical command path
 * @returns New settings object with `hooks.SessionStart` updated
 */
function mergeClaudeHooks(
  current: Record<string, unknown>,
  homeDir?: string,
): Record<string, unknown> {
  const hooks = readHooksObject(current, claudeSettingsJsonPath(homeDir));
  const sessionStart = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
  const cleaned = removeAllPeekHooks(sessionStart);
  const entry = peekHookEntry(homeDir);

  const matcherIdx = cleaned.findIndex(
    (group) => isMatcherGroup(group) && group.matcher === CLAUDE_SESSION_START_MATCHER,
  );
  let nextSessionStart: unknown[];
  if (matcherIdx >= 0) {
    const group = { ...(cleaned[matcherIdx] as Record<string, unknown>) };
    const groupHooks = Array.isArray(group.hooks) ? [...group.hooks] : [];
    groupHooks.push(entry);
    group.hooks = groupHooks;
    nextSessionStart = [...cleaned];
    nextSessionStart[matcherIdx] = group;
  } else {
    nextSessionStart = [...cleaned, { matcher: CLAUDE_SESSION_START_MATCHER, hooks: [entry] }];
  }
  nextSessionStart = dropGroupsEmptiedByRemoval(sessionStart, nextSessionStart);

  return { ...current, hooks: { ...hooks, SessionStart: nextSessionStart } };
}

/**
 * Remove every Grounder hook entry from every matcher group, touching
 * nothing else, and drop a matcher group only when this removal is what left
 * its `hooks` array empty (see {@link dropGroupsEmptiedByRemoval}) — clutter
 * Grounder itself created room for, not a group that started empty for
 * reasons of its own. Returns `current` verbatim when there's no Grounder
 * entry to remove, so `mergeJsonFile` sees no change and leaves an unrelated
 * `settings.json` untouched instead of reformatting it.
 */
function removeClaudeHooks(current: Record<string, unknown>): Record<string, unknown> {
  const hooks =
    current.hooks && typeof current.hooks === "object" && !Array.isArray(current.hooks)
      ? (current.hooks as Record<string, unknown>)
      : undefined;
  const sessionStart = hooks && Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
  if (findAllPeekHooks(sessionStart).length === 0) {
    return current;
  }
  const cleaned = dropGroupsEmptiedByRemoval(sessionStart, removeAllPeekHooks(sessionStart));
  return { ...current, hooks: { ...hooks, SessionStart: cleaned } };
}

/**
 * Install (or converge) Grounder's SessionStart teaser hook into `~/.claude/settings.json`.
 *
 * Also materializes `~/.grounder/runtime` (see {@link installHookRuntime}).
 * Always converges — no `--force` gate; `force` only affects whole-file
 * skill artifacts, never this shared-JSON fragment.
 *
 * Never clobbers: an unparseable settings.json backs off in
 * {@link mergeJsonFile}, and a present-but-non-object `hooks` key backs off in
 * {@link readHooksObject}. Either way this throws before anything is written.
 */
async function installHooks(opts: AgentInstallOptions): Promise<AgentInstallResult> {
  const dest = claudeSettingsJsonPath(opts.homeDir);
  const upToDate = await peekHookUpToDate(dest, opts.homeDir);

  if (upToDate) {
    return { artifacts: { [dest]: "skipped" } };
  }

  if (!opts.dryRun) {
    await installHookRuntime({ homeDir: opts.homeDir });
  }
  const fileExisted = await fileExists(dest);
  const hadGrounderEntry = fileExisted && (await peekHookHadGrounderEntry(dest));
  const result = await mergeJsonFile(dest, (current) => mergeClaudeHooks(current, opts.homeDir), {
    dryRun: opts.dryRun,
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  const status: ArtifactStatus = !result.changed
    ? "skipped"
    : hadGrounderEntry
      ? "overwritten"
      : "created";
  return { artifacts: { [dest]: status } };
}

/**
 * Remove Grounder's SessionStart hook entry entirely (`--no-hooks`) — the
 * opt-out must also remove the fragment, not just flip `hooksEnabled` false,
 * or the session hook keeps firing and the tri-state's stickiness against
 * the next plain `migrate` would have nothing to rest on.
 */
async function removeHooks(opts: AgentInstallOptions): Promise<AgentInstallResult> {
  const dest = claudeSettingsJsonPath(opts.homeDir);
  if (!(await fileExists(dest))) {
    return { artifacts: {} };
  }
  const result = await mergeJsonFile(dest, removeClaudeHooks, { dryRun: opts.dryRun });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.changed ? { artifacts: { [dest]: "overwritten" } } : { artifacts: {} };
}

export const claude: AgentAdapter = {
  id: "claude",
  name: "Claude Code",

  async isInstalled(): Promise<boolean> {
    return fileExists(path.join(resolveHomeDir(), ".claude"));
  },

  expectedArtifacts,
  expectedHookArtifacts,

  async desiredArtifacts(homeDir?: string): Promise<Record<string, string>> {
    const cli = runtimeInvocation(homeDir);
    const skillsDir = claudeSkillsDir(homeDir);
    const desired: Record<string, string> = {};
    for (const filename of COMMANDS) {
      const template = await readFile(path.join(templateDir, filename), "utf8");
      desired[path.join(skillsDir, filename)] = template.replaceAll("{{GROUNDER_CLI}}", cli);
    }
    return desired;
  },

  tombstones(homeDir?: string): string[] {
    const dir = legacyCommandsDir(homeDir);
    return LEGACY_COMMAND_FILENAMES.map((filename) => path.join(dir, filename));
  },

  ownedPrefixes(homeDir?: string): string[] {
    return [claudeSkillsDir(homeDir), legacyCommandsDir(homeDir)];
  },

  installHooks,
  removeHooks,
};
