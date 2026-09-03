import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHomeDir } from "../connector/home.js";
import { fileExists } from "../util/fs.js";
import { mergeJsonFile } from "../util/merge-json.js";
import { isAlreadyConverged, removeMatchingEntries } from "./hook-fragment.js";
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
const templateDir = path.join(pkgRoot, "templates", "agents", "cursor", "skills");

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
  return path.join(resolveHomeDir(homeDir), ".cursor", "commands");
}

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
  return path.join(resolveHomeDir(homeDir), ".cursor", "skills");
}

/** Absolute path to Cursor's shared hooks config (`~/.cursor/hooks.json`). */
export function cursorHooksJsonPath(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".cursor", "hooks.json");
}

export function grounderNoteCommandPath(homeDir?: string): string {
  return path.join(cursorSkillsDir(homeDir), "grounder-note", "SKILL.md");
}

export function grounderPlanCommandPath(homeDir?: string): string {
  return path.join(cursorSkillsDir(homeDir), "grounder-plan", "SKILL.md");
}

export function grounderTaskHandoffCommandPath(homeDir?: string): string {
  return path.join(cursorSkillsDir(homeDir), "grounder-task-handoff", "SKILL.md");
}

export function grounderTaskCommandPath(homeDir?: string): string {
  return path.join(cursorSkillsDir(homeDir), "grounder-task", "SKILL.md");
}

export function expectedArtifacts(homeDir?: string): string[] {
  return COMMANDS.map((filename) => path.join(cursorSkillsDir(homeDir), filename));
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

function readSessionStart(parsed: unknown): unknown[] | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const hooks = (parsed as Record<string, unknown>).hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    return null;
  }
  const sessionStart = (hooks as Record<string, unknown>).sessionStart;
  return Array.isArray(sessionStart) ? sessionStart : null;
}

/** Whether `hooks.json` already lists any Grounder peek command (for status labeling). */
async function peekHookHadGrounderEntry(filePath: string): Promise<boolean> {
  try {
    const sessionStart = readSessionStart(JSON.parse(await readFile(filePath, "utf8")));
    return (sessionStart ?? []).some(isCursorPeekEntry);
  } catch {
    return false;
  }
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
  try {
    const sessionStart = readSessionStart(JSON.parse(await readFile(filePath, "utf8")));
    if (!sessionStart) {
      return false;
    }
    return isAlreadyConverged(sessionStart, isCursorPeekEntry, {
      command: cursorPeekHookCommand(homeDir),
    });
  } catch {
    return false;
  }
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

  const hooks =
    next.hooks && typeof next.hooks === "object" && !Array.isArray(next.hooks)
      ? { ...(next.hooks as Record<string, unknown>) }
      : {};
  const existing = Array.isArray(hooks.sessionStart) ? hooks.sessionStart : [];
  const cleaned = removeMatchingEntries(existing, isCursorPeekEntry);
  cleaned.push({ command: cursorPeekHookCommand(homeDir) });

  next.hooks = { ...hooks, sessionStart: cleaned };
  return next;
}

/** Remove every Grounder peek entry from `hooks.sessionStart`, touching nothing else. */
function removeCursorHooks(current: Record<string, unknown>): Record<string, unknown> {
  const hooks =
    current.hooks && typeof current.hooks === "object" && !Array.isArray(current.hooks)
      ? { ...(current.hooks as Record<string, unknown>) }
      : {};
  const existing = Array.isArray(hooks.sessionStart) ? hooks.sessionStart : [];
  return {
    ...current,
    hooks: { ...hooks, sessionStart: removeMatchingEntries(existing, isCursorPeekEntry) },
  };
}

/**
 * Install (or converge) Grounder's sessionStart teaser hook into `~/.cursor/hooks.json`.
 *
 * Also materializes `~/.grounder/runtime` (see {@link installHookRuntime}).
 * Always converges — no `--force` gate; `force` only affects whole-file
 * skill artifacts, never this shared-JSON fragment.
 *
 * Unparseable hooks.json: {@link mergeJsonFile} backs off and this throws (never clobbers).
 */
async function installHooks(opts: AgentInstallOptions): Promise<AgentInstallResult> {
  const dest = cursorHooksJsonPath(opts.homeDir);
  const upToDate = await peekHookUpToDate(dest, opts.homeDir);

  if (upToDate) {
    return { artifacts: { [dest]: "skipped" } };
  }

  if (!opts.dryRun) {
    await installHookRuntime({ homeDir: opts.homeDir });
  }
  const fileExisted = await fileExists(dest);
  const hadGrounderEntry = fileExisted && (await peekHookHadGrounderEntry(dest));
  const result = await mergeJsonFile(
    dest,
    (current) => mergeCursorHooks(current, !fileExisted, opts.homeDir),
    { dryRun: opts.dryRun },
  );

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
 * Remove Grounder's sessionStart hook entry entirely (`--no-hooks`) — the
 * opt-out must also remove the fragment, not just flip `hooksEnabled` false,
 * or the session hook keeps firing and the next plain `migrate` would find
 * nothing to converge against (an absent entry looks like "never installed",
 * which is exactly what makes the tri-state's `false` sticky in the first
 * place).
 */
async function removeHooks(opts: AgentInstallOptions): Promise<AgentInstallResult> {
  const dest = cursorHooksJsonPath(opts.homeDir);
  if (!(await fileExists(dest))) {
    return { artifacts: {} };
  }
  const result = await mergeJsonFile(dest, removeCursorHooks, { dryRun: opts.dryRun });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.changed ? { artifacts: { [dest]: "overwritten" } } : { artifacts: {} };
}

export const cursor: AgentAdapter = {
  id: "cursor",
  name: "Cursor",

  async isInstalled(): Promise<boolean> {
    return fileExists(path.join(resolveHomeDir(), ".cursor"));
  },

  expectedArtifacts,
  expectedHookArtifacts,

  async desiredArtifacts(homeDir?: string): Promise<Record<string, string>> {
    const cli = runtimeInvocation(homeDir);
    const skillsDir = cursorSkillsDir(homeDir);
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

  installHooks,
  removeHooks,
};
