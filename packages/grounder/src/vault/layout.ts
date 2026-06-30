/**
 * Pure vault layout: path segments only — no config files or env overrides.
 */

import path from "node:path";

export const PROJECTS_DIR = "10-Projects";
export const AI_DIR = "00-AI";

export function projectsParent(vaultRoot: string): string {
  return path.join(vaultRoot, PROJECTS_DIR);
}

export function projectDir(vaultRoot: string, projectId: string): string {
  return path.join(vaultRoot, PROJECTS_DIR, projectId);
}

export function notesDir(vaultRoot: string, projectId: string): string {
  return path.join(vaultRoot, PROJECTS_DIR, projectId, "notes");
}

export function aiDir(vaultRoot: string): string {
  return path.join(vaultRoot, AI_DIR);
}

export function projectsJsonPath(vaultRoot: string): string {
  return path.join(aiDir(vaultRoot), "projects.json");
}
