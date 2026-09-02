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
// array. Idempotency: {@link isGrounderPeekHookCommand} (runtime path or legacy npx).
// ---------------------------------------------------------------------------

function findPeekHookIndex(sessionStart: unknown[]): number {
  return sessionStart.findIndex(
    (item) =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      isGrounderPeekHookCommand((item as { command?: unknown }).command),
  );
}

/** Whether `hooks.json` already lists any Grounder peek command (for status labeling). */
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
    const sessionStart = (hooks as Record<string, unknown>).sessionStart;
    return Array.isArray(sessionStart) && findPeekHookIndex(sessionStart) >= 0;
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
    const sessionStart = (hooks as Record<string, unknown>).sessionStart;
    if (!Array.isArray(sessionStart)) {
      return false;
    }
    const idx = findPeekHookIndex(sessionStart);
    if (idx < 0) {
      return false;
    }
    const command = (sessionStart[idx] as { command?: unknown }).command;
    return command === cursorPeekHookCommand(homeDir);
  } catch {
    return false;
  }
}

/**
 * Deep-merge Grounder's sessionStart hook into an existing hooks.json object.
 *
 * Preserves every key except the nested path it owns. Strategy:
 * 1. If a Grounder peek hook already exists (runtime or legacy npx) → replace in place.
 * 2. Else → append Grounder's entry to `hooks.sessionStart`.
 *
 * On a brand-new file (`isFreshFile`), also sets `version: 1` when absent.
 * Existing files keep whatever `version` (or lack of it) they already have.
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
  const existing = Array.isArray(hooks.sessionStart) ? [...hooks.sessionStart] : [];
  const entry = { command: cursorPeekHookCommand(homeDir) };
  const idx = findPeekHookIndex(existing);
  if (idx >= 0) {
    // Path 1: refresh existing Grounder hook entry in place
    existing[idx] = entry;
  } else {
    // Path 2: append — first install, or file had other sessionStart hooks only
    existing.push(entry);
  }

  next.hooks = { ...hooks, sessionStart: existing };
  return next;
}

/**
 * Install (or refresh) Grounder's sessionStart teaser hook into `~/.cursor/hooks.json`.
 *
 * Also materializes `~/.grounder/runtime` (see {@link installHookRuntime}).
 *
 * Force semantics:
 * - Up-to-date canonical entry + fresh runtime and `force` false → skip
 * - Otherwise → refresh runtime + merge host config
 *
 * Unparseable hooks.json: {@link mergeJsonFile} backs off and this throws (never clobbers).
 */
async function installHooks(opts: AgentInstallOptions): Promise<AgentInstallResult> {
  const dest = cursorHooksJsonPath(opts.homeDir);
  const upToDate = await peekHookUpToDate(dest, opts.homeDir);

  if (upToDate && !opts.force) {
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

  // `force` can land here even when nothing would actually change (e.g. the
  // canonical entry is correct but the runtime symlink was stale) — trust
  // the merge's own before/after comparison, not just "did we run it."
  const status: ArtifactStatus = !result.changed
    ? "skipped"
    : hadGrounderEntry
      ? "overwritten"
      : "created";
  return { artifacts: { [dest]: status } };
}

export const cursor: AgentAdapter = {
  id: "cursor",
  name: "Cursor",
  commandsSchema: 4,
  hooksSchema: 1,

  async isInstalled(): Promise<boolean> {
    return fileExists(path.join(resolveHomeDir(), ".cursor"));
  },

  expectedArtifacts,
  expectedHookArtifacts,

  async install(opts: AgentInstallOptions): Promise<AgentInstallResult> {
    const artifacts: Record<string, ArtifactStatus> = {};
    const files: Record<string, { hash: string }> = {};
    for (const filename of COMMANDS) {
      const { dest, status, hash } = await installCommandFile({
        ...opts,
        agentId: cursor.id,
        templateDir,
        commandsDir: cursorSkillsDir(opts.homeDir),
        filename,
      });
      artifacts[dest] = status;
      if (hash) {
        files[dest] = { hash };
      }
    }
    await recordCommandFileHashes({
      agentId: cursor.id,
      commandsSchema: cursor.commandsSchema,
      files,
      homeDir: opts.homeDir,
      dryRun: opts.dryRun,
    });
    return { artifacts };
  },

  installHooks,
};
