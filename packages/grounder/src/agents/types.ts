/**
 * - `created` / `overwritten` — wrote new content
 * - `skipped` — already current (or dry-run would no-op)
 * - `modified` — on-disk content differs from last Grounder write; left alone
 *   unless `--force`
 */
export type ArtifactStatus = "created" | "skipped" | "overwritten" | "modified";

export interface AgentInstallOptions {
  force?: boolean;
  /** Preview decisions without writing files or updating the install ledger. */
  dryRun?: boolean;
  homeDir?: string;
}

export interface AgentInstallResult {
  /** Map of installed file path → what happened to it. */
  artifacts: Record<string, ArtifactStatus>;
}

export interface AgentAdapter {
  /** Stable lowercase id used in config and flags, e.g. "cursor". */
  readonly id: string;
  /** Human-readable display name, e.g. "Cursor". */
  readonly name: string;
  /** Returns true when this agent appears to be installed on the machine. */
  isInstalled(): Promise<boolean>;
  /** Absolute paths of whole-file artifacts this adapter installs (read-only inspect). */
  expectedArtifacts(homeDir?: string): string[];
  /**
   * Pure render (package-local template read only, no host filesystem
   * touched): every whole-file artifact this adapter currently wants
   * installed, path → rendered content. Reconciled against the ledger and
   * disk by `reconcile()`.
   */
  desiredArtifacts(homeDir?: string): Promise<Record<string, string>>;
  /**
   * Historical paths a previous install shape wrote that the current shape no
   * longer wants at all (e.g. pre-Agent-Skills command markdown) — unioned
   * into the "previous desired" side of `reconcile()`'s diff so they retire
   * even when the ledger never recorded them (pre-hash-tracking installs).
   */
  tombstones(homeDir?: string): string[];
  /** Optional: install session hooks (separate from whole-file artifact install). */
  installHooks?(opts: AgentInstallOptions): Promise<AgentInstallResult>;
  /** Optional: absolute path(s) of hook config this adapter would touch. */
  expectedHookArtifacts?(homeDir?: string): string[];
}
