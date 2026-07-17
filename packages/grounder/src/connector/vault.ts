// Config-aware vault resolution: effective vault root and artifact paths from connector state.
import path from "node:path";
import type { HomeConfig } from "./home.js";
import type { RepoConfig } from "./repo.js";
import { logsDir, notesDir } from "../vault/layout.js";

/**
 * Effective vault root, in order: explicit `override`, `GROUNDER_VAULT`, then home config.
 */
export function resolveVaultRoot(home: HomeConfig, override?: string): string {
  if (override) {
    return path.resolve(override);
  }
  if (process.env.GROUNDER_VAULT) {
    return path.resolve(process.env.GROUNDER_VAULT);
  }
  return path.resolve(home.vaultRoot);
}

/** Project notes directory under the effective vault root. */
export function resolveNotesDir(
  home: HomeConfig,
  repo: RepoConfig,
  vaultOverride?: string,
): string {
  const vaultRoot = resolveVaultRoot(home, vaultOverride);
  return notesDir(vaultRoot, repo.projectId);
}

/** Project logs (handoff) directory under the effective vault root. */
export function resolveLogsDir(
  home: HomeConfig,
  repo: RepoConfig,
  vaultOverride?: string,
): string {
  const vaultRoot = resolveVaultRoot(home, vaultOverride);
  return logsDir(vaultRoot, repo.projectId);
}
