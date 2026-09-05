import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveHomeDir } from "../connector/home.js";
import { fileExists } from "../util/fs.js";
import { homeSkillsLayout } from "./home-skills.js";
import { readEventEntries, readHooksObject, removeMatchingEntries } from "./hook-fragment.js";
import { installHookFragment, removeHookFragment } from "./hook-install.js";
import { isGrounderPeekHookCommand, isHookRuntimeStale, peekHookCommand } from "./hook-runtime.js";
import type { AgentAdapter, AgentInstallOptions, AgentInstallResult } from "./types.js";

/** Whole-file artifacts: `~/.claude/skills/` plus the retired `~/.claude/commands/`. */
const layout = homeSkillsLayout({ id: "claude", agentDir: ".claude" });

/** Hook event Grounder owns in `settings.json`. */
const SESSION_START_EVENT = "SessionStart";

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
  return layout.skillsDir(homeDir);
}

/** Absolute path to Claude Code's shared settings file (`~/.claude/settings.json`). */
export function claudeSettingsJsonPath(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".claude", "settings.json");
}

export function grounderNoteCommandPath(homeDir?: string): string {
  return layout.skillPath("grounder-note", homeDir);
}

export function grounderPlanCommandPath(homeDir?: string): string {
  return layout.skillPath("grounder-plan", homeDir);
}

export function grounderTaskHandoffCommandPath(homeDir?: string): string {
  return layout.skillPath("grounder-task-handoff", homeDir);
}

export function grounderTaskCommandPath(homeDir?: string): string {
  return layout.skillPath("grounder-task", homeDir);
}

export function expectedArtifacts(homeDir?: string): string[] {
  return layout.expectedArtifacts(homeDir);
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

/** `hooks.SessionStart` from a settings.json on disk; `null` if absent or unreadable. */
async function readSessionStart(filePath: string): Promise<unknown[] | null> {
  try {
    return readEventEntries(JSON.parse(await readFile(filePath, "utf8")), SESSION_START_EVENT);
  } catch {
    return null;
  }
}

/** Whether `settings.json` already lists any Grounder peek command (for status labeling). */
async function peekHookHadGrounderEntry(filePath: string): Promise<boolean> {
  return findAllPeekHooks((await readSessionStart(filePath)) ?? []).length > 0;
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
  const sessionStart = await readSessionStart(filePath);
  if (!sessionStart) {
    return false;
  }
  const placed = findAllPeekHooksPlaced(sessionStart);
  if (placed.length !== 1 || placed[0].matcher !== CLAUDE_SESSION_START_MATCHER) {
    return false;
  }
  return JSON.stringify(placed[0].hook) === JSON.stringify(peekHookEntry(homeDir));
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
  const raw = hooks[SESSION_START_EVENT];
  const sessionStart = Array.isArray(raw) ? raw : [];
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

  return { ...current, hooks: { ...hooks, [SESSION_START_EVENT]: nextSessionStart } };
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
  const raw = hooks?.[SESSION_START_EVENT];
  const sessionStart = Array.isArray(raw) ? raw : [];
  if (findAllPeekHooks(sessionStart).length === 0) {
    return current;
  }
  const cleaned = dropGroupsEmptiedByRemoval(sessionStart, removeAllPeekHooks(sessionStart));
  return { ...current, hooks: { ...hooks, [SESSION_START_EVENT]: cleaned } };
}

/**
 * Install (or converge) Grounder's SessionStart teaser hook into `~/.claude/settings.json`.
 * @see {@link installHookFragment} for the shared install/report scaffolding.
 */
async function installHooks(opts: AgentInstallOptions): Promise<AgentInstallResult> {
  return installHookFragment(
    {
      dest: claudeSettingsJsonPath(opts.homeDir),
      isUpToDate: (filePath) => peekHookUpToDate(filePath, opts.homeDir),
      hasGrounderEntry: peekHookHadGrounderEntry,
      merge: (current) => mergeClaudeHooks(current, opts.homeDir),
    },
    opts,
  );
}

/**
 * Remove Grounder's SessionStart hook entry entirely (`--no-hooks`) — the
 * opt-out must also remove the fragment, not just flip `hooksEnabled` false,
 * or the session hook keeps firing and the tri-state's stickiness against
 * the next plain `migrate` would have nothing to rest on.
 */
async function removeHooks(opts: AgentInstallOptions): Promise<AgentInstallResult> {
  return removeHookFragment(claudeSettingsJsonPath(opts.homeDir), removeClaudeHooks, opts);
}

export const claude: AgentAdapter = {
  id: "claude",
  name: "Claude Code",

  isInstalled: layout.isInstalled,
  expectedArtifacts,
  expectedHookArtifacts,
  desiredArtifacts: layout.desiredArtifacts,
  tombstones: layout.tombstones,
  ownedPrefixes: layout.ownedPrefixes,

  installHooks,
  removeHooks,
};
