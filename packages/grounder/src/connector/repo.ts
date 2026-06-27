import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../util/fs.js";

export interface RepoConfig {
  version: 1;
  projectId: string;
}

const REPO_MARKER_FILE = ".grounder.json";

export function repoConfigPath(repoRoot: string): string {
  return path.join(repoRoot, REPO_MARKER_FILE);
}

export async function readRepoConfig(repoRoot: string): Promise<RepoConfig | null> {
  const configPath = repoConfigPath(repoRoot);
  if (!(await fileExists(configPath))) {
    return null;
  }

  const raw = JSON.parse(await readFile(configPath, "utf8")) as Partial<RepoConfig>;
  if (raw.version !== 1 || typeof raw.projectId !== "string" || raw.projectId.length === 0) {
    throw new Error(`Invalid repo config at ${configPath}`);
  }

  return { version: 1, projectId: raw.projectId };
}

export async function writeRepoConfig(repoRoot: string, config: RepoConfig): Promise<void> {
  const configPath = repoConfigPath(repoRoot);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
