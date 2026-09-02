import type { GrounderState } from "../connector/state.js";

/**
 * - `retired` — on-disk hash matched the ledger (or `--force`); file deleted
 * - `left-modified` — on-disk content differs from what Grounder last wrote; left alone
 * - `already-absent` — nothing at that path; steady state, not reported
 */
export type LegacyRetireStatus = "retired" | "left-modified" | "already-absent";

/**
 * Shaped around `004-retire-legacy-commands.ts` — the only migration today.
 * `status` is deliberately the concrete `LegacyRetireStatus` rather than a
 * generic `kind: string`, since there's exactly one migration to fit and
 * generalizing now would be guessing at a shape for migrations that don't
 * exist yet. If a second migration lands with a genuinely different result
 * shape, generalize `Migration`/`MigrationArtifactResult` then — see the
 * maintainer checklist in `docs/architecture/migrations.md`.
 */
export interface MigrationArtifactResult {
  agentId: string;
  path: string;
  status: LegacyRetireStatus;
}

export interface MigrationContext {
  homeDir?: string;
  force: boolean;
  dryRun: boolean;
  /** Agent ids in scope for this migrate run — a migration only touches these. */
  agentIds: readonly string[];
  /** Ledger snapshot, already read by the caller — reused for hash comparisons. */
  state: GrounderState | null;
}

export interface Migration {
  /** Which `commandsSchema` release introduced this migration (metadata only). */
  schemaVersion: number;
  description: string;
  /**
   * Runs unconditionally on every `grounder migrate` — not schema-gated. Each
   * migration is responsible for its own idempotency (existence/hash checks).
   */
  run(ctx: MigrationContext): Promise<MigrationArtifactResult[]>;
}
