import path from "node:path";

/**
 * Pure reconciliation core — no I/O anywhere in this file.
 *
 * Two shapes, per the design: {@link desiredDrift} answers "would migrate
 * change something" cheaply (ledger vs. rendered template hashes only, no
 * disk read) for `peek`/`status`; {@link reconcile} is the full three-way
 * (desired vs. ledger vs. on-disk) plan `setup`/`migrate`/`doctor` execute or
 * preview. Modeled on chezmoi's source/destination/target state and dpkg's
 * old-pristine/new-pristine/on-disk compare.
 */

/**
 * True when `filePath` sits under one of `prefixes` (a directory, matched
 * exactly or via a `prefix + separator` boundary — never a bare substring
 * match). Callers use this to keep a ledger's extra/stray entries — a
 * hand-edited or corrupted `state.json`, say — from ever being treated as
 * delete candidates for paths outside the directories an adapter actually
 * manages. `reconcile()` itself stays agnostic to this (see its own docs);
 * callers filter `ledger` before passing it in.
 */
export function isUnderOwnedPrefix(filePath: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => filePath === prefix || filePath.startsWith(`${prefix}${path.sep}`),
  );
}

export type DriftKind = "create" | "update";

export interface DriftEntry {
  path: string;
  kind: DriftKind;
}

/** One agent's last-applied manifest — path → hash of the bytes Grounder wrote. */
export type LedgerManifest = Record<string, { hash?: string }>;

/**
 * Compare desired (rendered template) hashes against one agent's last-applied
 * ledger manifest. No disk I/O — the caller renders + hashes templates, and
 * passes in the ledger's `files` map already read from `state.json`.
 *
 * `ledger === undefined` means this agent has no ledger entry at all (never
 * installed) — returns no drift. Scoping to ledger-recorded agents lives
 * here, not in every caller: otherwise a detected-but-never-installed agent
 * would tease `migrate` forever with no command able to silence it.
 *
 * Within a ledger-recorded agent, a desired path missing from its `files` map
 * IS drift (`"create"`) — that's how a newly added skill file surfaces here.
 */
export function desiredDrift(
  desired: Record<string, string>,
  ledger: LedgerManifest | undefined,
): DriftEntry[] {
  if (!ledger) {
    return [];
  }
  const out: DriftEntry[] = [];
  for (const [path, hash] of Object.entries(desired)) {
    const recorded = ledger[path]?.hash;
    if (recorded === undefined) {
      out.push({ path, kind: "create" });
    } else if (recorded !== hash) {
      out.push({ path, kind: "update" });
    }
  }
  return out;
}

export type PlanAction = "create" | "update" | "delete" | "conflict" | "noop" | "forget";

export interface PlanEntry {
  path: string;
  action: PlanAction;
  /** Only set when `action === "conflict"` — which action `--force` would take. */
  blockedAction?: "overwrite" | "delete";
}

/** path → on-disk content hash, `undefined` when the path does not exist. */
export type DiskHashes = Record<string, string | undefined>;

/**
 * Full three-way reconcile for one agent's whole-file artifacts: desired
 * (current templates) vs. ledger (last-applied) vs. disk (actual). Pure —
 * `disk`/`ledger` are already-read snapshots, not live filesystem access.
 *
 * `tombstones` are extra "previously desired, no longer desired" paths
 * (pre-skill command files, etc.) unioned into the retirement side of the
 * diff even when the ledger never recorded them — the case a pure
 * ledger-manifest diff is blind to (pre-hash-tracking installs).
 *
 * Safety: only ever call this for a known agent id whose `desired` this
 * binary can actually compute — never for an unrecognized ledger entry,
 * which would treat its entire recorded file set as delete candidates.
 */
export function reconcile(
  desired: Record<string, string>,
  tombstones: readonly string[],
  ledger: LedgerManifest | undefined,
  disk: DiskHashes,
  force: boolean,
): PlanEntry[] {
  const ledgerFiles = ledger ?? {};
  const allPaths = new Set<string>([
    ...Object.keys(desired),
    ...Object.keys(ledgerFiles),
    ...tombstones,
  ]);

  const entries: PlanEntry[] = [];
  for (const path of allPaths) {
    const desiredHash = desired[path];
    const ledgerHash = ledgerFiles[path]?.hash;
    const onDisk = disk[path];

    if (desiredHash !== undefined) {
      // Whole-file artifact currently wanted.
      if (onDisk === undefined) {
        entries.push({ path, action: "create" });
      } else if (onDisk === desiredHash) {
        entries.push({ path, action: "noop" });
      } else if (force || (ledgerHash !== undefined && ledgerHash === onDisk)) {
        entries.push({ path, action: "update" });
      } else {
        entries.push({ path, action: "conflict", blockedAction: "overwrite" });
      }
      continue;
    }

    // Not in the current desired set — retirement candidate (tombstone, or a
    // path dropped from the manifest by a schema change).
    if (onDisk === undefined) {
      // Already gone — noop, not a recurring delete (doctor would otherwise
      // warn about an already-cleaned-up legacy path forever). If the ledger
      // still holds a stale hash for it (removed outside `migrate`), that's
      // a ledger-only cleanup ("forget"), not a file action.
      entries.push({ path, action: ledgerHash !== undefined ? "forget" : "noop" });
    } else if (force || (ledgerHash !== undefined && ledgerHash === onDisk)) {
      entries.push({ path, action: "delete" });
    } else {
      entries.push({ path, action: "conflict", blockedAction: "delete" });
    }
  }

  return entries;
}

/**
 * Would applying `plan` actually change the ledger? Pure — mirrors exactly
 * what `applyPlan()`'s per-artifact writes do (each has its own no-op guard):
 * `create`/`update`/`noop` only write when the recorded hash would actually
 * change; `delete` only forgets an entry that exists; `forget` always writes
 * (by construction it only exists when there's something to forget);
 * `conflict` never touches the ledger. Used so `--dry-run` and a real run
 * predict/report the exact same thing for the exact same reason.
 */
export function planChangesLedger(
  plan: readonly PlanEntry[],
  ledger: LedgerManifest | undefined,
  desired: Record<string, string>,
): boolean {
  const ledgerFiles = ledger ?? {};
  for (const entry of plan) {
    switch (entry.action) {
      case "create":
      case "update":
      case "noop": {
        const desiredHash = desired[entry.path];
        if (desiredHash !== undefined && ledgerFiles[entry.path]?.hash !== desiredHash) {
          return true;
        }
        break;
      }
      case "delete":
        if (ledgerFiles[entry.path]?.hash !== undefined) {
          return true;
        }
        break;
      case "forget":
        return true;
      case "conflict":
        break;
    }
  }
  return false;
}
