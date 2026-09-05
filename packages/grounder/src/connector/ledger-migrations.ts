/**
 * `state.json`'s own on-disk shape versioning — separate from install-content
 * drift (skill files, hooks), which the reconciler already owns. Bump
 * `LEDGER_SCHEMA` and add one `upgradeFromN` step whenever the file's shape
 * itself changes; `readGrounderState` (in `state.ts`) is the only caller.
 *
 * No file I/O in this module. Every upgrade step takes raw untyped JSON in
 * and returns the next version's raw JSON out — never `GrounderState`
 * mid-chain, so a step can't accidentally assume a field the target shape
 * doesn't have yet.
 */

/** Bumped only when `state.json`'s own on-disk shape changes (not install content). */
export const LEDGER_SCHEMA = 1;

/** Oldest on-disk shape this binary can still upgrade from — the pre-rewrite shape
 * (no `ledgerSchema` field, `commandsSchema`/`hooksSchema` instead of `hooksEnabled`)
 * is the only one that has ever existed on disk. */
export const MIN_SUPPORTED_LEDGER_SCHEMA = 0;

export type LedgerUpgradeStep = (raw: Record<string, unknown>) => Record<string, unknown>;
export type LedgerUpgradeTable = Record<number, LedgerUpgradeStep>;

/** v0.5.0's real (only ever released) per-agent shape — legacy schema ints, no `hooksEnabled`. */
interface RawAgentEntryV0 {
  files?: unknown;
  /** Legacy: folded into `hooksEnabled` via `hooksSchema > 0`. */
  hooksSchema?: unknown;
  /** Legacy: ignored entirely — no replacement content-schema int (see version hard stop). */
  commandsSchema?: unknown;
}

/**
 * Schema 0 → 1: drop `commandsSchema` (no replacement) and fold `hooksSchema` into
 * `hooksEnabled` — a positive `hooksSchema` (hooks were actually installed) maps to
 * `true`; `hooksSchema: 0`, an absent `hooksSchema`, or a non-numeric value all leave
 * `hooksEnabled` unset. `0` deliberately does NOT map to `false`: `false` means an
 * explicit `--no-hooks` opt-out, a flag that didn't exist in v0.5.0, so there's no v0.5.0
 * ledger state that should ever produce it — mapping `0` to `false` would turn a machine
 * that simply never installed hooks into a sticky opt-out, silencing `shouldInstallHooks`'s
 * on-disk-recognizer fallback for it forever. (In practice v0.5.0's writer only ever
 * persisted `hooksSchema` as the installed schema constant or omitted it entirely, so `0`
 * likely never hit a real ledger — this is a correctness fix for the mapping, not a
 * reaction to an observed bad value.) No `hooksEnabled`-already-present case: `hooksEnabled`
 * didn't exist before schema 1, so a schema-0 file (v0.5.0, the only released shape without
 * `ledgerSchema`) can never carry it.
 */
export function upgradeFrom0(raw: Record<string, unknown>): Record<string, unknown> {
  const rawAgents = raw.agents;
  if (!rawAgents || typeof rawAgents !== "object" || Array.isArray(rawAgents)) {
    return raw;
  }

  const agents: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(rawAgents as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      agents[id] = entry;
      continue;
    }
    const e = entry as RawAgentEntryV0;
    const hooksEnabled = typeof e.hooksSchema === "number" && e.hooksSchema > 0 ? true : undefined;
    agents[id] = {
      files: e.files,
      ...(hooksEnabled !== undefined ? { hooksEnabled } : {}),
    };
  }
  return { ...raw, agents };
}

/** One entry per version below `LEDGER_SCHEMA` — not a stub per hypothetical future version. */
export const REAL_LEDGER_UPGRADE_TABLE: LedgerUpgradeTable = {
  0: upgradeFrom0,
};

/**
 * Walk `raw` from schema `from` up to (not including) `target`, one step per
 * version. The walker owns the version counter — it stamps `v + 1` onto the
 * result after each step runs, rather than trusting each step to bump it
 * itself, so a step that forgets to would never cause an infinite loop here.
 *
 * A missing table entry or a step that throws both surface as the same
 * invalid-state `Error` family the rest of `readGrounderState` uses — never a
 * bare `TypeError` escaping a read.
 *
 * Test-only entry point for exercising multi-step chaining against a fake
 * table, without bumping production `LEDGER_SCHEMA` just to test it.
 * Production reads should use `applyLedgerUpgrades`.
 */
export function applyLedgerUpgradeTable(
  raw: Record<string, unknown>,
  from: number,
  table: LedgerUpgradeTable,
  target: number,
): Record<string, unknown> {
  let current = raw;
  for (let v = from; v < target; v++) {
    const step = table[v];
    if (!step) {
      throw new Error(`Invalid grounder state: no ledger upgrade from schema ${v}`);
    }
    let next: Record<string, unknown>;
    try {
      next = step(current);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid grounder state: ledger upgrade from schema ${v} failed: ${detail}`);
    }
    current = { ...next, ledgerSchema: v + 1 };
  }
  return current;
}

/** Production entry point — thin wrapper over `applyLedgerUpgradeTable` with the real table. */
export function applyLedgerUpgrades(
  raw: Record<string, unknown>,
  from: number,
): Record<string, unknown> {
  return applyLedgerUpgradeTable(raw, from, REAL_LEDGER_UPGRADE_TABLE, LEDGER_SCHEMA);
}
