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
  schema: number;
  /** `sha256:…` of the exact bytes Grounder last wrote (see `hashContent`). */
  hash?: string;
}

export interface AgentState {
  commandsSchema: number;
  hooksSchema?: number;
  files: Record<string, AgentFileState>;
}

export interface GrounderState {
  /** Package version that last wrote install artifacts (via vault init / migrate). */
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

/** Recorded hooks schema for an agent, or `0` when missing (legacy / never installed). */
export function recordedHooksSchema(state: GrounderState | null, agentId: string): number {
  return state?.agents[agentId]?.hooksSchema ?? 0;
}

export interface RecordAgentInstallOptions {
  agentId: string;
  /**
   * When set, updates `commandsSchema`; when omitted, preserves any existing
   * value (or `0` for a new agent entry). Omit when command files were all
   * skipped as locally modified / legacy so the ledger does not falsely look
   * current.
   */
  commandsSchema?: number;
  /** When set, updates `hooksSchema`; when omitted, preserves any existing value. */
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
 * Merge one agent's install metadata into the ledger. Creates `state.json` when
 * absent. Preserves other agents and merges any provided `files` over the
 * existing map for this agent.
 */
export async function recordAgentInstall(opts: RecordAgentInstallOptions): Promise<GrounderState> {
  const existing = await readGrounderState(opts.homeDir);
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

  const next: GrounderState = {
    grounderVersion: opts.grounderVersion,
    agents: {
      ...(existing?.agents ?? {}),
      [opts.agentId]: nextEntry,
    },
  };
  await writeGrounderState(next, opts.homeDir);
  return next;
}

/**
 * True when recorded install schemas lag what this binary expects.
 * Missing state → not stale here (callers treat null as legacy separately).
 * Only agents present in the ledger are compared — unknown/uninstalled
 * adapters are ignored (no `isInstalled` I/O).
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

/** Last-recorded content hash for a managed file, or `undefined` if unknown. */
export function recordedFileHash(
  state: GrounderState | null,
  agentId: string,
  filePath: string,
): string | undefined {
  return state?.agents[agentId]?.files[filePath]?.hash;
}

/**
 * Hard-stop when `state.json` records a schema newer than this binary's
 * adapters understand. Missing state / unknown agents are fine (legacy).
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

    for (const [filePath, file] of Object.entries(recorded.files)) {
      if (typeof file?.schema === "number" && file.schema > agent.commandsSchema) {
        throw new UnsupportedSchemaError(
          `${agent.name} file ${filePath} schema ${file.schema} is newer than this grounder supports (${agent.commandsSchema}). Upgrade grounder.`,
        );
      }
    }
  }
}
