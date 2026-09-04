import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveHomeDir } from "../connector/home.js";
import { fileExists } from "../util/fs.js";
import { homeSkillsLayout } from "./home-skills.js";
import {
  isAlreadyConverged,
  readEventEntries,
  readHooksObject,
  removeMatchingEntries,
} from "./hook-fragment.js";
import { installHookFragment, removeHookFragment } from "./hook-install.js";
import { isGrounderPeekHookCommand, isHookRuntimeStale, peekHookCommand } from "./hook-runtime.js";
import type { AgentAdapter, AgentInstallOptions, AgentInstallResult } from "./types.js";

/** Whole-file artifacts: `~/.cursor/skills/` plus the retired `~/.cursor/commands/`. */
const layout = homeSkillsLayout({ id: "cursor", agentDir: ".cursor" });

/** Hook event Grounder owns in `hooks.json`. */
const SESSION_START_EVENT = "sessionStart";

/**
 * Canonical sessionStart command for Cursor (home-local runtime, not `npx`).
 * Always includes `--json` so stdout matches Cursor's `additional_context` contract.
 * @see {@link peekHookCommand}
 */
export function cursorPeekHookCommand(
  homeDir?: string,
  extraArgs: readonly string[] = ["--json"],
): string {
  return peekHookCommand(homeDir, extraArgs);
}

export function cursorSkillsDir(homeDir?: string): string {
  return layout.skillsDir(homeDir);
}

/** Absolute path to Cursor's shared hooks config (`~/.cursor/hooks.json`). */
export function cursorHooksJsonPath(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".cursor", "hooks.json");
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

/** Paths of hook config this adapter touches — currently just `hooks.json`. */
export function expectedHookArtifacts(homeDir?: string): string[] {
  return [cursorHooksJsonPath(homeDir)];
}

// ---------------------------------------------------------------------------
// Session-start hook install (~/.cursor/hooks.json)
//
// Cursor hooks.json is a shared JSON object. Grounder only owns one entry in
// `hooks.sessionStart`; unrelated keys (other hook events, version, etc.) must
// survive merge. Relevant shape after install (path varies by home / Node):
//
//   {
//     "version": 1,
//     "hooks": {
//       "sessionStart": [
//         { "command": "'/path/to/node' '/path/to/.grounder/runtime/dist/cli.js' handoff peek --json" }
//       ]
//     }
//   }
//
// Terminology used below:
//   - hooks root     → the whole hooks.json object
//   - hooks          → hooksRoot.hooks (map of event name → hook entries)
//   - sessionStart   → hooks.sessionStart (flat array of { command } objects)
//   - hook entry     → { command: string }
//
// Unlike Claude Code, Cursor has no matcher groups — sessionStart is a flat
// array. Idempotency / recognizer: {@link isGrounderPeekHookCommand} (runtime
// path or legacy npx). Always-converge (Ansible `blockinfile` / Kubernetes
// Server-Side Apply sole-owner model): every recognizer match is removed and
// replaced with exactly one canonical entry — no conflict / `--force` gate.
// ---------------------------------------------------------------------------

function isCursorPeekEntry(item: unknown): item is { command: string } {
  return (
    item !== null &&
    typeof item === "object" &&
    !Array.isArray(item) &&
    isGrounderPeekHookCommand((item as { command?: unknown }).command)
  );
}

/** `hooks.sessionStart` from a hooks.json on disk; `null` if absent or unreadable. */
async function readSessionStart(filePath: string): Promise<unknown[] | null> {
  try {
    return readEventEntries(JSON.parse(await readFile(filePath, "utf8")), SESSION_START_EVENT);
  } catch {
    return null;
  }
}

/** Whether `hooks.json` already lists any Grounder peek command (for status labeling). */
async function peekHookHadGrounderEntry(filePath: string): Promise<boolean> {
  return ((await readSessionStart(filePath)) ?? []).some(isCursorPeekEntry);
}

/**
 * Skip only when exactly one canonical entry is already present *and* the
 * runtime is current for the running grounder version/source. Anything else
 * — no entry, a legacy `npx` form, a drifted command, more than one match —
 * always converges. No `--force` required to migrate or pick up an upgrade.
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
  return isAlreadyConverged(sessionStart, isCursorPeekEntry, {
    command: cursorPeekHookCommand(homeDir),
  });
}

/**
 * Converge Grounder's sessionStart hook into an existing hooks.json object:
 * remove every recognizer match (runtime-form or legacy npx, however many),
 * append exactly one canonical entry.
 *
 * Preserves every key except the nested path it owns. On a brand-new file
 * (`isFreshFile`), also sets `version: 1` when absent. Existing files keep
 * whatever `version` (or lack of it) they already have.
 *
 * @param current - Parsed hooks.json root (object). Other top-level keys untouched.
 * @param isFreshFile - True when the file did not exist before this write
 * @param homeDir - Home override for the canonical command path
 * @returns New hooks object with `hooks.sessionStart` updated
 */
function mergeCursorHooks(
  current: Record<string, unknown>,
  isFreshFile: boolean,
  homeDir?: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  if (isFreshFile && next.version === undefined) {
    next.version = 1;
  }

  const hooks = readHooksObject(next, cursorHooksJsonPath(homeDir));
  const raw = hooks[SESSION_START_EVENT];
  const existing = Array.isArray(raw) ? raw : [];
  const cleaned = removeMatchingEntries(existing, isCursorPeekEntry);
  cleaned.push({ command: cursorPeekHookCommand(homeDir) });

  next.hooks = { ...hooks, [SESSION_START_EVENT]: cleaned };
  return next;
}

/**
 * Remove every Grounder peek entry from `hooks.sessionStart`, touching
 * nothing else. Returns `current` verbatim (no restructuring at all) when
 * there's no Grounder entry to remove, so `mergeJsonFile` sees no change and
 * leaves an unrelated `hooks.json` untouched instead of reformatting it.
 */
function removeCursorHooks(current: Record<string, unknown>): Record<string, unknown> {
  const hooks =
    current.hooks && typeof current.hooks === "object" && !Array.isArray(current.hooks)
      ? (current.hooks as Record<string, unknown>)
      : undefined;
  const raw = hooks?.[SESSION_START_EVENT];
  const existing = Array.isArray(raw) ? raw : [];
  const cleaned = removeMatchingEntries(existing, isCursorPeekEntry);
  if (cleaned.length === existing.length) {
    return current;
  }
  return {
    ...current,
    hooks: { ...hooks, [SESSION_START_EVENT]: cleaned },
  };
}

/**
 * Install (or converge) Grounder's sessionStart teaser hook into `~/.cursor/hooks.json`.
 * @see {@link installHookFragment} for the shared install/report scaffolding.
 */
async function installHooks(opts: AgentInstallOptions): Promise<AgentInstallResult> {
  return installHookFragment(
    {
      dest: cursorHooksJsonPath(opts.homeDir),
      isUpToDate: (filePath) => peekHookUpToDate(filePath, opts.homeDir),
      hasGrounderEntry: peekHookHadGrounderEntry,
      merge: (current, fileExisted) => mergeCursorHooks(current, !fileExisted, opts.homeDir),
    },
    opts,
  );
}

/**
 * Remove Grounder's sessionStart hook entry entirely (`--no-hooks`) — the
 * opt-out must also remove the fragment, not just flip `hooksEnabled` false,
 * or the session hook keeps firing and the next plain `migrate` would find
 * nothing to converge against (an absent entry looks like "never installed",
 * which is exactly what makes the tri-state's `false` sticky in the first
 * place).
 */
async function removeHooks(opts: AgentInstallOptions): Promise<AgentInstallResult> {
  return removeHookFragment(cursorHooksJsonPath(opts.homeDir), removeCursorHooks, opts);
}

export const cursor: AgentAdapter = {
  id: "cursor",
  name: "Cursor",

  isInstalled: layout.isInstalled,
  expectedArtifacts,
  expectedHookArtifacts,
  desiredArtifacts: layout.desiredArtifacts,
  tombstones: layout.tombstones,
  ownedPrefixes: layout.ownedPrefixes,

  installHooks,
  removeHooks,
};
