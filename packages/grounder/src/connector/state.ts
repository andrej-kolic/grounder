import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../util/fs.js";
import { resolveHomeDir } from "./home.js";

/** Per-file install record (hash filled in by later migrate/drift work). */
export interface AgentFileState {
  schema: number;
  hash?: string;
}

export interface AgentState {
  commandsSchema: number;
  hooksSchema?: number;
  files: Record<string, AgentFileState>;
}

export interface GrounderState {
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

  const raw = JSON.parse(await readFile(filePath, "utf8")) as Partial<GrounderState>;
  if (typeof raw.grounderVersion !== "string" || raw.grounderVersion.length === 0) {
    throw new Error(`Invalid grounder state at ${filePath}: missing grounderVersion`);
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
  commandsSchema: number;
  /** When set, updates `hooksSchema`; when omitted, preserves any existing value. */
  hooksSchema?: number;
  grounderVersion: string;
  homeDir?: string;
}

/**
 * Merge one agent's install metadata into the ledger. Creates `state.json` when
 * absent. Preserves other agents and any existing `files` map for this agent.
 */
export async function recordAgentInstall(opts: RecordAgentInstallOptions): Promise<GrounderState> {
  const existing = await readGrounderState(opts.homeDir);
  const prev = existing?.agents[opts.agentId];
  const nextEntry: AgentState = {
    commandsSchema: opts.commandsSchema,
    files: prev?.files ? { ...prev.files } : {},
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
