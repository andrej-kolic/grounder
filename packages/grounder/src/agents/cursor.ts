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
const templateDir = path.join(pkgRoot, "templates", "agents", "cursor", "commands");

const COMMANDS = ["grounder-note.md", "grounder-task-handoff.md", "grounder-task.md"] as const;

/**
 * Command string written into Cursor's sessionStart hook entry.
 * Used as the idempotency key when scanning/merging `hooks.sessionStart`.
 */
export const CURSOR_PEEK_HOOK_COMMAND = "npx grounder handoff peek";

export function cursorCommandsDir(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".cursor", "commands");
}

/** Absolute path to Cursor's shared hooks config (`~/.cursor/hooks.json`). */
export function cursorHooksJsonPath(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".cursor", "hooks.json");
}

export function grounderNoteCommandPath(homeDir?: string): string {
  return path.join(cursorCommandsDir(homeDir), "grounder-note.md");
}

export function grounderTaskHandoffCommandPath(homeDir?: string): string {
  return path.join(cursorCommandsDir(homeDir), "grounder-task-handoff.md");
}

export function grounderTaskCommandPath(homeDir?: string): string {
  return path.join(cursorCommandsDir(homeDir), "grounder-task.md");
}

export function expectedArtifacts(homeDir?: string): string[] {
  return COMMANDS.map((filename) => path.join(cursorCommandsDir(homeDir), filename));
}

/** Paths of hook config this adapter touches — currently just `hooks.json`. */
export function expectedHookArtifacts(homeDir?: string): string[] {
  return [cursorHooksJsonPath(homeDir)];
}

async function installCommand(
  filename: (typeof COMMANDS)[number],
  opts: AgentInstallOptions,
): Promise<{ dest: string; status: ArtifactStatus }> {
  const dest = path.join(cursorCommandsDir(opts.homeDir), filename);
  const existed = await fileExists(dest);

  if (existed && !opts.force) {
    return { dest, status: "skipped" };
  }

  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(path.join(templateDir, filename), dest);
  return { dest, status: existed ? "overwritten" : "created" };
}

// ---------------------------------------------------------------------------
// Session-start hook install (~/.cursor/hooks.json)
//
// Cursor hooks.json is a shared JSON object. Grounder only owns one entry in
// `hooks.sessionStart`; unrelated keys (other hook events, version, etc.) must
// survive merge. Relevant shape after install:
//
//   {
//     "version": 1,
//     "hooks": {
//       "sessionStart": [
//         { "command": "npx grounder handoff peek" }
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
// array. Idempotency: locate Grounder's entry by matching
// `command === CURSOR_PEEK_HOOK_COMMAND`.
// ---------------------------------------------------------------------------

/**
 * @param hooks - `hooksRoot.hooks` object (may be missing or malformed)
 * @returns Whether `hooks.sessionStart` already contains Grounder's command
 */
function sessionStartHasPeekCommand(hooks: unknown): boolean {
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    return false;
  }
  const sessionStart = (hooks as Record<string, unknown>).sessionStart;
  if (!Array.isArray(sessionStart)) {
    return false;
  }
  return sessionStart.some(
    (item) =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as { command?: unknown }).command === CURSOR_PEEK_HOOK_COMMAND,
  );
}

/**
 * Read `hooks.json` and report whether Grounder's sessionStart hook is present.
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
 * Deep-merge Grounder's sessionStart hook into an existing hooks.json object.
 *
 * Preserves every key except the nested path it owns. Strategy:
 * 1. If a hook with `command === CURSOR_PEEK_HOOK_COMMAND` already exists → replace
 *    that entry in place (refresh to the canonical `{ command }` shape).
 * 2. Else → append Grounder's entry to `hooks.sessionStart`.
 *
 * On a brand-new file (`isFreshFile`), also sets `version: 1` when absent.
 * Existing files keep whatever `version` (or lack of it) they already have.
 *
 * @param current - Parsed hooks.json root (object). Other top-level keys untouched.
 * @param isFreshFile - True when the file did not exist before this write
 * @returns New hooks object with `hooks.sessionStart` updated
 */
function mergeCursorHooks(
  current: Record<string, unknown>,
  isFreshFile: boolean,
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
  const entry = { command: CURSOR_PEEK_HOOK_COMMAND };
  const idx = existing.findIndex(
    (item) =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as { command?: unknown }).command === CURSOR_PEEK_HOOK_COMMAND,
  );
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
 * Force semantics match slash-command install:
 * - Grounder entry missing → merge in, status `created`
 * - Grounder entry present and `force` false → leave file untouched, status `skipped`
 * - Grounder entry present and `force` true → re-merge canonical entry, status `overwritten`
 *
 * Unparseable hooks.json: {@link mergeJsonFile} backs off and this throws (never clobbers).
 */
async function installHooks(opts: AgentInstallOptions): Promise<AgentInstallResult> {
  const dest = cursorHooksJsonPath(opts.homeDir);
  const alreadyHas = await peekHookAlreadyInstalled(dest);

  if (alreadyHas && !opts.force) {
    return { artifacts: { [dest]: "skipped" } };
  }

  const fileExisted = await fileExists(dest);
  const result = await mergeJsonFile(dest, (current) => mergeCursorHooks(current, !fileExisted));

  if (!result.ok) {
    throw new Error(result.message);
  }

  const status: ArtifactStatus = alreadyHas ? "overwritten" : "created";
  return { artifacts: { [dest]: status } };
}

export const cursor: AgentAdapter = {
  id: "cursor",
  name: "Cursor",

  async isInstalled(): Promise<boolean> {
    return fileExists(path.join(resolveHomeDir(), ".cursor"));
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
