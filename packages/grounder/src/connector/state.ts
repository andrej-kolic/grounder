import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../util/fs.js";
import { packageVersionRelation } from "../util/semver.js";
import { resolveHomeDir } from "./home.js";
import { UnsupportedSchemaError } from "./unsupported-schema.js";

/** Bumped only when `state.json`'s own on-disk shape changes (not install content). */
export const LEDGER_SCHEMA = 1;

/** Per-file install record for chezmoi-style drift detection on managed markdown. */
export interface AgentFileState {
  /** `sha256:…` of the exact bytes Grounder last wrote (see `hashContent`). */
  hash: string;
}

export interface AgentLedgerEntry {
  files: Record<string, AgentFileState>;
  /**
   * Tri-state, deliberately not a plain boolean: `undefined` = never recorded
   * (legacy ledger, or hooks never touched), `true` = on, `false` =
   * explicitly turned off via `--no-hooks`. Collapsing "never recorded" into
   * `false` would make setup/migrate's disk-recognizer hydration silently
   * flip a user's `--no-hooks` opt-out back on.
   */
  hooksEnabled?: boolean;
}

export interface GrounderState {
  /** `state.json`'s own file-format version — forward-compat for the ledger shape itself. */
  ledgerSchema: number;
  /** Package version that last wrote install artifacts (via setup / migrate). */
  grounderVersion: string;
  agents: Record<string, AgentLedgerEntry>;
}

export function statePath(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".grounder", "state.json");
}

/** Raw on-disk shape before/after the reconciler rewrite — old keys tolerated, never written. */
interface RawAgentEntry {
  files?: unknown;
  hooksEnabled?: unknown;
  /** Legacy: fallback for `hooksEnabled` only when `hooksEnabled` itself is absent. */
  hooksSchema?: unknown;
  /** Legacy: ignored entirely — no replacement content-schema int (see version hard stop). */
  commandsSchema?: unknown;
}

/**
 * Read `~/.grounder/state.json`. Missing file → `null` (legacy / pre-ledger
 * install). Tolerates the pre-rewrite on-disk shape (`commandsSchema`,
 * `hooksSchema`, no `ledgerSchema`) so the first run after upgrading does not
 * crash on a machine's real, old-shape ledger.
 */
export async function readGrounderState(homeDir?: string): Promise<GrounderState | null> {
  const filePath = statePath(homeDir);
  if (!(await fileExists(filePath))) {
    return null;
  }

  let raw: Partial<GrounderState> & { agents?: Record<string, RawAgentEntry> };
  try {
    raw = JSON.parse(await readFile(filePath, "utf8")) as typeof raw;
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

  const agents: Record<string, AgentLedgerEntry> = {};
  for (const [id, entry] of Object.entries(raw.agents)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid grounder state at ${filePath}: bad agent entry "${id}"`);
    }
    const filesRaw = entry.files;
    const files: Record<string, AgentFileState> =
      filesRaw && typeof filesRaw === "object" && !Array.isArray(filesRaw)
        ? (filesRaw as Record<string, AgentFileState>)
        : {};

    let hooksEnabled: boolean | undefined;
    if (typeof entry.hooksEnabled === "boolean") {
      hooksEnabled = entry.hooksEnabled;
    } else if (typeof entry.hooksSchema === "number") {
      hooksEnabled = entry.hooksSchema > 0;
    }

    agents[id] = {
      files,
      ...(hooksEnabled !== undefined ? { hooksEnabled } : {}),
    };
  }

  return {
    ledgerSchema: typeof raw.ledgerSchema === "number" ? raw.ledgerSchema : 0,
    grounderVersion: raw.grounderVersion,
    agents,
  };
}

/** Atomic write — tmp file + rename, so a crash mid-write never leaves a truncated ledger. */
export async function writeGrounderState(state: GrounderState, homeDir?: string): Promise<void> {
  const filePath = statePath(homeDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

/** Last-recorded content hash for a managed file, or `undefined` if unknown. */
export function recordedFileHash(
  state: GrounderState | null,
  agentId: string,
  filePath: string,
): string | undefined {
  return state?.agents[agentId]?.files[filePath]?.hash;
}

/** One agent's last-applied manifest, or `undefined` when this agent has no ledger entry at all. */
export function ledgerFilesFor(
  state: GrounderState | null,
  agentId: string,
): Record<string, AgentFileState> | undefined {
  return state?.agents[agentId]?.files;
}

/** Tri-state hooks intent for an agent: `undefined` (never recorded) / `true` / `false`. */
export function recordedHooksEnabled(
  state: GrounderState | null,
  agentId: string,
): boolean | undefined {
  return state?.agents[agentId]?.hooksEnabled;
}

function withUpdatedAgent(
  existing: GrounderState | null,
  agentId: string,
  updateEntry: (prev: AgentLedgerEntry) => AgentLedgerEntry,
  grounderVersion: string,
): GrounderState {
  const prevAgent: AgentLedgerEntry = existing?.agents[agentId] ?? { files: {} };
  return {
    ledgerSchema: LEDGER_SCHEMA,
    grounderVersion,
    agents: {
      ...(existing?.agents ?? {}),
      [agentId]: updateEntry(prevAgent),
    },
  };
}

/**
 * Persist one file's hash for one agent, right after that file's own write
 * succeeds — per-artifact, not batched, so a mid-run crash leaves the ledger
 * consistent with whatever actually completed. No-op if already current.
 */
export async function setLedgerFileHash(opts: {
  agentId: string;
  filePath: string;
  hash: string;
  grounderVersion: string;
  homeDir?: string;
}): Promise<void> {
  const existing = await readGrounderState(opts.homeDir);
  if (existing?.agents[opts.agentId]?.files[opts.filePath]?.hash === opts.hash) {
    return;
  }
  const next = withUpdatedAgent(
    existing,
    opts.agentId,
    (prev) => ({ ...prev, files: { ...prev.files, [opts.filePath]: { hash: opts.hash } } }),
    opts.grounderVersion,
  );
  await writeGrounderState(next, opts.homeDir);
}

/**
 * Drop one path's ledger entry — for a file deleted outright (tombstone
 * retirement), where there is no new hash to overwrite it with. No-op when
 * there's no state, no such agent, or no recorded entry for that path.
 */
export async function forgetLedgerFile(opts: {
  agentId: string;
  filePath: string;
  grounderVersion: string;
  homeDir?: string;
}): Promise<void> {
  const existing = await readGrounderState(opts.homeDir);
  const prevAgent = existing?.agents[opts.agentId];
  if (!existing || !prevAgent || !(opts.filePath in prevAgent.files)) {
    return;
  }
  const files = Object.fromEntries(
    Object.entries(prevAgent.files).filter(([p]) => p !== opts.filePath),
  );
  const next = withUpdatedAgent(
    existing,
    opts.agentId,
    (prev) => ({ ...prev, files }),
    opts.grounderVersion,
  );
  await writeGrounderState(next, opts.homeDir);
}

/** Persist an agent's hooks intent (tri-state). Setup/migrate only — never called from doctor. */
export async function setHooksEnabled(opts: {
  agentId: string;
  enabled: boolean;
  grounderVersion: string;
  homeDir?: string;
}): Promise<void> {
  const existing = await readGrounderState(opts.homeDir);
  if (existing?.agents[opts.agentId]?.hooksEnabled === opts.enabled) {
    return;
  }
  const next = withUpdatedAgent(
    existing,
    opts.agentId,
    (prev) => ({ ...prev, hooksEnabled: opts.enabled }),
    opts.grounderVersion,
  );
  await writeGrounderState(next, opts.homeDir);
}

/**
 * Stamp `grounderVersion` unconditionally — the hook for an all-noop plan
 * (nothing else in a per-artifact write loop touches it when every entry was
 * `noop`), so the upgrade banner still clears on a fully-current machine.
 */
export async function touchGrounderVersion(
  grounderVersion: string,
  homeDir?: string,
): Promise<void> {
  const existing = await readGrounderState(homeDir);
  if (existing?.grounderVersion === grounderVersion) {
    return;
  }
  await writeGrounderState(
    { ledgerSchema: LEDGER_SCHEMA, grounderVersion, agents: existing?.agents ?? {} },
    homeDir,
  );
}

/**
 * Write-path-only hard stop (gap 2): an older binary reconciling a ledger
 * written by a newer one must refuse to write, not silently overwrite newer
 * skill files with older ones. Never called from `doctor`/`status`/`peek` —
 * those keep today's warning and stay fully functional against a newer
 * ledger (see `package-version-notice.ts`'s `"behind"` branch).
 */
export function assertVersionSupportsWrite(
  runningVersion: string,
  state: GrounderState | null,
): void {
  if (!state) {
    return;
  }
  if (packageVersionRelation(runningVersion, state.grounderVersion) === "behind") {
    throw new UnsupportedSchemaError(
      `This Grounder (${runningVersion}) is older than your configuration (${state.grounderVersion}). Install a newer Grounder.`,
    );
  }
}
