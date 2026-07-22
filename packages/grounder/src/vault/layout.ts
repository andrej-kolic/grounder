/**
 * Pure vault layout: path segments only — no config files or env overrides.
 */

import path from "node:path";

export const PROJECTS_DIR = "10-Projects";

/** `<vault>/10-Projects` — parent of all project folders. */
export function projectsParent(vaultRoot: string): string {
  return path.join(vaultRoot, PROJECTS_DIR);
}

/** `<vault>/10-Projects/{projectId}`. */
export function projectDir(vaultRoot: string, projectId: string): string {
  return path.join(vaultRoot, PROJECTS_DIR, projectId);
}

/** `<vault>/10-Projects/{projectId}/notes`. */
export function notesDir(vaultRoot: string, projectId: string): string {
  return path.join(vaultRoot, PROJECTS_DIR, projectId, "notes");
}

/** `<vault>/10-Projects/{projectId}/logs` — session handoffs. */
export function logsDir(vaultRoot: string, projectId: string): string {
  return path.join(vaultRoot, PROJECTS_DIR, projectId, "logs");
}
