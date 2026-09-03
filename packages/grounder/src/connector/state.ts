import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../util/fs.js";
import { resolveHomeDir } from "./home.js";
import { UnsupportedSchemaError } from "./unsupported-schema.js";

/** Minimal adapter shape for forward-compat schema compares. */
export interface AgentSchemaSupport {
  id: string;
  name: string;
  commandsSchema: number;
  hooksSchema?: number;
}

/** Per-file install record for chezmoi-style drift detection on command markdown. */
export interface AgentFileState {
  /** `sha256:…` of the exact bytes Grounder last wrote (see `hashContent`). */
  hash?: string;
}

export interface AgentState {
  commandsSchema: number;
  hooksSchema?: number;
  files: Record<string, AgentFileState>;
}

export interface GrounderState {
  /** Package version that last wrote install artifacts (via setup / migrate). */
  grounderVersion: string;
  agents: Record<string, AgentState>;
}

export function statePath(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".grounder", "state.json");
}

/**
 * Read `~/.grounder/state.json`. Missing file → `null` (legacy / pre-ledger
 * install — callers should treat missing agent entries as schema 0).
 */
export async function readGrounderState(homeDir?: string): Promise<GrounderState | null> {
  const filePath = statePath(homeDir);
  if (!(await fileExists(filePath))) {
    return null;
  }

  let raw: Partial<GrounderState>;
  try {
    raw = JSON.parse(await readFile(filePath, "utf8")) as Partial<GrounderState>;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid grounder state at ${filePath}: ${detail}. Fix or remove it, then run: grounder migrate --force`,
    );
  }
  if (typeof raw.grounderVersion !== "string" || raw.grounderVersion.length === 0) {
    throw new Error(
      `Invalid grounder state at ${filePath}: missing grounderVersion. Fix or remove it, then run: grounder migrate --force`,
    );
  }
  if (raw.agents === null || typeof raw.agents !== "object" || Array.isArray(raw.agents)) {
    throw new Error(`Invalid grounder state at ${filePath}: missing agents`);
  }

  const agents: Record<string, AgentState> = {};
  for (const [id, entry] of Object.entries(raw.agents)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid grounder state at ${filePath}: bad agent entry "${id}"`);
    }
    const commandsSchema = (entry as AgentState).commandsSchema;
    if (typeof commandsSchema !== "number" || !Number.isInteger(commandsSchema)) {
      throw new Error(
        `Invalid grounder state at ${filePath}: agent "${id}" missing commandsSchema`,
      );
    }
    const hooksSchema = (entry as AgentState).hooksSchema;
    if (
      hooksSchema !== undefined &&
      (typeof hooksSchema !== "number" || !Number.isInteger(hooksSchema))
    ) {
      throw new Error(
        `Invalid grounder state at ${filePath}: agent "${id}" has invalid hooksSchema`,
      );
    }
    const filesRaw = (entry as AgentState).files;
    const files: Record<string, AgentFileState> =
      filesRaw && typeof filesRaw === "object" && !Array.isArray(filesRaw) ? { ...filesRaw } : {};
    agents[id] = {
      commandsSchema,
      ...(hooksSchema !== undefined ? { hooksSchema } : {}),
      files,
    };
  }

  return { grounderVersion: raw.grounderVersion, agents };
}

export async function writeGrounderState(state: GrounderState, homeDir?: string): Promise<void> {
  const filePath = statePath(homeDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** Recorded commands schema for an agent, or `0` when missing (legacy). */
export function recordedCommandsSchema(state: GrounderState | null, agentId: string): number {
  return state?.agents[agentId]?.commandsSchema ?? 0;
}

/** Hooks version stored for an agent, or `0` if missing (never stored / never installed). */
export function recordedHooksSchema(state: GrounderState | null, agentId: string): number {
  return state?.agents[agentId]?.hooksSchema ?? 0;
}

export interface RecordAgentInstallOptions {
  agentId: string;
  /**
   * When set, updates the commands version in state; when omitted, keeps the
   * existing value (or `0` for a new agent). Omit when every skill file was
   * skipped as locally edited or from an old install, so state does not look
   * up to date when the files were not updated.
   */
  commandsSchema?: number;
  /** When set, updates the hooks version; when omitted, keeps any existing value. */
  hooksSchema?: number;
  /**
   * Merge into the agent's `files` map (absolute path → state). Omitting leaves
   * existing entries alone; pass `{}` is a no-op merge.
   */
  files?: Record<string, AgentFileState>;
  grounderVersion: string;
  homeDir?: string;
}

/**
 * The ledger state after merging in `opts` — pure, no reading or writing.
 * Both the real write path ({@link recordAgentInstall}) and a `--dry-run`
 * preview call this same function, so they can never disagree about whether
 * a write is a no-op.
 */
function withAgentInstall(
  existing: GrounderState | null,
  opts: RecordAgentInstallOptions,
): GrounderState {
  const prev = existing?.agents[opts.agentId];
  const nextEntry: AgentState = {
    commandsSchema:
      opts.commandsSchema !== undefined ? opts.commandsSchema : (prev?.commandsSchema ?? 0),
    files: {
      ...(prev?.files ? { ...prev.files } : {}),
      ...(opts.files ?? {}),
    },
  };
  if (opts.hooksSchema !== undefined) {
    nextEntry.hooksSchema = opts.hooksSchema;
  } else if (prev?.hooksSchema !== undefined) {
    nextEntry.hooksSchema = prev.hooksSchema;
  }

  return {
    grounderVersion: opts.grounderVersion,
    agents: {
      ...(existing?.agents ?? {}),
      [opts.agentId]: nextEntry,
    },
  };
}

/** Deterministic stringify, keys sorted at every level — order-independent structural compare. */
function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      return v.map(sort);
    }
    if (v && typeof v === "object") {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[key] = sort((v as Record<string, unknown>)[key]);
      }
      return sorted;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

/**
 * Structural equality between two ledger states — immune to incidental JSON
 * key-order differences (e.g. a ledger entry written by an older Grounder
 * whose field order doesn't match what the current code produces).
 */
export function grounderStatesEqual(a: GrounderState | null, b: GrounderState | null): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * Would persisting `opts` actually change `state.json`? Pure — reads nothing,
 * writes nothing. Callers use this to decide whether a real write is needed
 * (and skip it when it's a no-op) and to predict the outcome under
 * `--dry-run`, from the exact same computation.
 */
export function wouldChangeGrounderState(
  existing: GrounderState | null,
  opts: RecordAgentInstallOptions,
): boolean {
  return !grounderStatesEqual(existing, withAgentInstall(existing, opts));
}

/**
 * Merge one agent's install info into `~/.grounder/state.json`. Creates the
 * file when missing. Keeps other agents and merges any provided `files` over
 * this agent's existing map.
 */
export async function recordAgentInstall(opts: RecordAgentInstallOptions): Promise<GrounderState> {
  const existing = await readGrounderState(opts.homeDir);
  const next = withAgentInstall(existing, opts);
  await writeGrounderState(next, opts.homeDir);
  return next;
}

/**
 * True when `state.json` says this machine's install is behind what this
 * Grounder version expects. Used by peek/status — they only read `state.json`,
 * they do not look at Cursor/Claude files on disk.
 *
 * If there is no state file, returns false (callers handle that separately).
 * Only agents listed in state are checked.
 *
 * Session hooks: if an agent has no `hooksSchema` in state, that means hooks
 * were never turned on for them. That is not "behind" — otherwise peek would
 * keep telling people who never enabled hooks to run migrate. Doctor verifies
 * on-disk command/hook drift via migrate dry-run, and also warns when files
 * already match but these ledger schema numbers still lag.
 */
export function isInstallSchemaStale(
  state: GrounderState | null,
  agents: ReadonlyArray<AgentSchemaSupport>,
): boolean {
  if (!state) {
    return false;
  }

  for (const agent of agents) {
    const entry = state.agents[agent.id];
    if (!entry) {
      continue;
    }
    if (entry.commandsSchema < agent.commandsSchema) {
      return true;
    }
    if (
      agent.hooksSchema !== undefined &&
      entry.hooksSchema !== undefined &&
      entry.hooksSchema < agent.hooksSchema
    ) {
      return true;
    }
  }
  return false;
}

/**
 * True when state says hooks are newer than this Grounder understands.
 * No stored hooks version is not "newer".
 */
export function isHooksSchemaAhead(
  recorded: number | undefined,
  expected: number | undefined,
): boolean {
  if (expected === undefined || recorded === undefined) {
    return false;
  }
  return recorded > expected;
}

/** Last-recorded content hash for a managed file, or `undefined` if unknown. */
export function recordedFileHash(
  state: GrounderState | null,
  agentId: string,
  filePath: string,
): string | undefined {
  return state?.agents[agentId]?.files[filePath]?.hash;
}

/**
 * Drop one path's entry from an agent's `files` map — for a file deleted
 * outright (not rewritten), where `recordAgentInstall`'s merge-in-new-hashes
 * shape has nothing to overwrite it with. A no-op when there's no state, no
 * such agent, or no recorded entry for that path.
 */
export async function forgetRecordedFile(
  agentId: string,
  filePath: string,
  homeDir?: string,
): Promise<void> {
  const state = await readGrounderState(homeDir);
  const entry = state?.agents[agentId];
  if (!state || !entry || !(filePath in entry.files)) {
    return;
  }

  const files = Object.fromEntries(
    Object.entries(entry.files).filter(([recordedPath]) => recordedPath !== filePath),
  );
  await writeGrounderState(
    {
      ...state,
      agents: { ...state.agents, [agentId]: { ...entry, files } },
    },
    homeDir,
  );
}

/**
 * Hard stop when `state.json` has install versions newer than this Grounder
 * understands. Missing state or unknown agents are fine (older installs).
 */
export function assertAgentSchemasSupported(
  state: GrounderState | null,
  agents: ReadonlyArray<AgentSchemaSupport>,
): void {
  if (!state) {
    return;
  }

  for (const agent of agents) {
    const recorded = state.agents[agent.id];
    if (!recorded) {
      continue;
    }

    if (recorded.commandsSchema > agent.commandsSchema) {
      throw new UnsupportedSchemaError(
        `${agent.name} commands schema ${recorded.commandsSchema} is newer than this grounder supports (${agent.commandsSchema}). Upgrade grounder.`,
      );
    }

    if (
      recorded.hooksSchema !== undefined &&
      agent.hooksSchema !== undefined &&
      recorded.hooksSchema > agent.hooksSchema
    ) {
      throw new UnsupportedSchemaError(
        `${agent.name} hooks schema ${recorded.hooksSchema} is newer than this grounder supports (${agent.hooksSchema}). Upgrade grounder.`,
      );
    }
  }
}
