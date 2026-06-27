import path from "node:path";
import type { HomeConfig, RepoConfig } from "./config.js";
import { resolveVaultRoot } from "./config.js";

export const PROJECTS_DIR = "10-Projects";

export function resolveProjectDir(
  vaultRoot: string,
  projectId: string,
): string {
  return path.join(vaultRoot, PROJECTS_DIR, projectId);
}

export function resolveNotesDir(
  home: HomeConfig,
  repo: RepoConfig,
  vaultOverride?: string,
): string {
  const vaultRoot = resolveVaultRoot(home, vaultOverride);
  return path.join(vaultRoot, PROJECTS_DIR, repo.projectId, "notes");
}

export function resolveProjectsParent(vaultRoot: string): string {
  return path.join(vaultRoot, PROJECTS_DIR);
}
