import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../util/fs.js";
import { projectsJsonPath } from "./layout.js";

export interface RegistryEntry {
  /** Absolute path to the project folder (where .grounder.json lives). */
  repo: string;
  /** Vault-relative path to the notes directory. */
  notesDir: string;
}

export interface Registry {
  projects: Record<string, RegistryEntry>;
}

export async function readRegistry(vaultRoot: string): Promise<Registry> {
  const filePath = projectsJsonPath(vaultRoot);
  if (!(await fileExists(filePath))) {
    return { projects: {} };
  }
  const raw = JSON.parse(await readFile(filePath, "utf8")) as Partial<Registry>;
  return { projects: raw.projects ?? {} };
}

export async function writeRegistry(vaultRoot: string, registry: Registry): Promise<void> {
  const filePath = projectsJsonPath(vaultRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

export async function upsertProject(
  vaultRoot: string,
  projectId: string,
  entry: RegistryEntry,
): Promise<void> {
  const registry = await readRegistry(vaultRoot);
  registry.projects[projectId] = entry;
  await writeRegistry(vaultRoot, registry);
}
