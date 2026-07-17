// Config-aware vault resolution: effective vault root and artifact paths from connector state.
import path from "node:path";
import type { HomeConfig } from "./home.js";
import type { RepoConfig } from "./repo.js";
import { logsDir, notesDir } from "../vault/layout.js";

export function resolveVaultRoot(home: HomeConfig, override?: string): string {
  if (override) {
    return path.resolve(override);
  }
  if (process.env.GROUNDER_VAULT) {
    return path.resolve(process.env.GROUNDER_VAULT);
  }
  return path.resolve(home.vaultRoot);
}

export function resolveNotesDir(
  home: HomeConfig,
  repo: RepoConfig,
  vaultOverride?: string,
): string {
  const vaultRoot = resolveVaultRoot(home, vaultOverride);
  return notesDir(vaultRoot, repo.projectId);
}

export function resolveLogsDir(
  home: HomeConfig,
  repo: RepoConfig,
  vaultOverride?: string,
): string {
  const vaultRoot = resolveVaultRoot(home, vaultOverride);
  return logsDir(vaultRoot, repo.projectId);
}
