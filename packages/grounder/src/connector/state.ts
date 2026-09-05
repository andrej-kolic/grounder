import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileExists, writeFileAtomic } from "../util/fs.js";
import { packageVersionRelation } from "../util/semver.js";
import { resolveHomeDir } from "./home.js";
import {
  applyLedgerUpgrades,
  LEDGER_SCHEMA,
  MIN_SUPPORTED_LEDGER_SCHEMA,
} from "./ledger-migrations.js";
import { UnsupportedSchemaError } from "./unsupported-schema.js";

export { LEDGER_SCHEMA, MIN_SUPPORTED_LEDGER_SCHEMA } from "./ledger-migrations.js";

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

/**
 * Read `~/.grounder/state.json`. Missing file → `null` (legacy / pre-ledger
 * install). A `ledgerSchema` older than current (only v0.5.0's real shape —
 * `commandsSchema`/`hooksSchema`, no `ledgerSchema` field — has ever existed
 * on disk) is upgraded to the current shape in memory only; disk is untouched
 * until a real ledger write (`setup`/`migrate`/`setLedgerFileHash`/etc).
 * `status`, `doctor`, and `handoff peek` must never write `state.json` as a
 * side effect of reading it.
 *
 * The gate runs immediately after `JSON.parse`, ahead of the
 * `grounderVersion`/`agents` validation below: a schema-2 file that
 * restructures `agents` must report "upgrade grounder", not "missing
 * agents — fix or remove it".
 */
export async function readGrounderState(homeDir?: string): Promise<GrounderState | null> {
  const filePath = statePath(homeDir);
  if (!(await fileExists(filePath))) {
    return null;
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid grounder state at ${filePath}: ${detail}. Fix or remove it, then run: grounder migrate --force`,
    );
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    // Same "missing grounderVersion" message a non-object payload already
    // gets further down (`raw.grounderVersion` on a boxed number/string
    // reads as `undefined`, not a throw) — `null` is the one JSON value
    // whose property access throws before reaching that check, so it's
    // guarded here explicitly rather than falling through.
    throw new Error(
      `Invalid grounder state at ${filePath}: missing grounderVersion. Fix or remove it, then run: grounder migrate --force`,
    );
  }

  let ledgerSchema: number;
  if (raw.ledgerSchema === undefined) {
    ledgerSchema = 0;
  } else if (typeof raw.ledgerSchema === "number" && Number.isInteger(raw.ledgerSchema)) {
    ledgerSchema = raw.ledgerSchema;
  } else {
    // Deliberate tightening, not preserved behavior: previously a non-number
    // silently became `0`.
    throw new Error(
      `Invalid grounder state at ${filePath}: ledgerSchema must be an integer. Fix or remove it, then run: grounder migrate --force`,
    );
  }

  if (ledgerSchema > LEDGER_SCHEMA) {
    throw new UnsupportedSchemaError(
      `${filePath} requires ledger schema ${ledgerSchema}; this grounder supports ${LEDGER_SCHEMA}. Upgrade grounder.`,
    );
  }
  if (ledgerSchema < MIN_SUPPORTED_LEDGER_SCHEMA) {
    throw new Error(
      `Invalid grounder state at ${filePath}: ledger schema ${ledgerSchema} is older than this grounder supports (minimum ${MIN_SUPPORTED_LEDGER_SCHEMA}). Fix or remove it, then run: grounder migrate --force`,
    );
  }

  const upgraded = applyLedgerUpgrades(raw, ledgerSchema);

  if (typeof upgraded.grounderVersion !== "string" || upgraded.grounderVersion.length === 0) {
    throw new Error(
      `Invalid grounder state at ${filePath}: missing grounderVersion. Fix or remove it, then run: grounder migrate --force`,
    );
  }
  if (
    upgraded.agents === null ||
    typeof upgraded.agents !== "object" ||
    Array.isArray(upgraded.agents)
  ) {
    throw new Error(`Invalid grounder state at ${filePath}: missing agents`);
  }

  // Explicit field-by-field construction (not a spread of `upgraded`'s agent
  // entries) so an upgraded-but-unknown key can never round-trip back to disk
  // through `withUpdatedAgent`'s `...existing.agents` spread.
  const agents: Record<string, AgentLedgerEntry> = {};
  for (const [id, entry] of Object.entries(upgraded.agents as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid grounder state at ${filePath}: bad agent entry "${id}"`);
    }
    const e = entry as { files?: unknown; hooksEnabled?: unknown };
    const filesRaw = e.files;
    // Drop, rather than cast through, any file entry whose `hash` isn't a
    // string — a corrupted or hand-edited `{ hash: 123 }` / `{}` entry would
    // otherwise persist forever via `withUpdatedAgent`'s `...prev.files`
    // spread and compare unequal to every real hash anyway.
    const files: Record<string, AgentFileState> = {};
    if (filesRaw && typeof filesRaw === "object" && !Array.isArray(filesRaw)) {
      for (const [entryPath, fileEntry] of Object.entries(filesRaw as Record<string, unknown>)) {
        const hash = (fileEntry as { hash?: unknown } | null)?.hash;
        if (typeof hash === "string") {
          files[entryPath] = { hash };
        }
      }
    }
    const hooksEnabled = typeof e.hooksEnabled === "boolean" ? e.hooksEnabled : undefined;
    agents[id] = { files, ...(hooksEnabled !== undefined ? { hooksEnabled } : {}) };
  }

  return { ledgerSchema: LEDGER_SCHEMA, grounderVersion: upgraded.grounderVersion, agents };
}

/** Atomic write — tmp file + rename, so a crash mid-write never leaves a truncated ledger. */
export async function writeGrounderState(state: GrounderState, homeDir?: string): Promise<void> {
  await writeFileAtomic(statePath(homeDir), `${JSON.stringify(state, null, 2)}\n`);
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
 * Shared by `touchGrounderVersion`'s own no-op guard and `migrate`/`setup`'s
 * reported "did the ledger change" row, so the two can't independently drift
 * on the same comparison.
 */
export function ledgerVersionChanged(
  existing: GrounderState | null,
  grounderVersion: string,
): boolean {
  return existing?.grounderVersion !== grounderVersion;
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
  if (!ledgerVersionChanged(existing, grounderVersion)) {
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
