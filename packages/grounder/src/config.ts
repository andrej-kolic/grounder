import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface HomeConfig {
  vaultRoot: string;
}

export interface RepoConfig {
  version: 1;
  projectId: string;
}

const REPO_CONFIG_FILE = ".grounder.json";

export function resolveHomeDir(): string {
  return process.env.GROUNDER_HOME ?? os.homedir();
}

export function homeConfigPath(): string {
  return path.join(resolveHomeDir(), ".grounder", "config.json");
}

export function repoConfigPath(repoRoot: string): string {
  return path.join(repoRoot, REPO_CONFIG_FILE);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readHomeConfig(): Promise<HomeConfig | null> {
  const configPath = homeConfigPath();
  if (!(await fileExists(configPath))) {
    return null;
  }

  const raw = JSON.parse(await readFile(configPath, "utf8")) as Partial<HomeConfig>;
  if (typeof raw.vaultRoot !== "string" || raw.vaultRoot.length === 0) {
    throw new Error(`Invalid home config at ${configPath}: missing vaultRoot`);
  }

  return { vaultRoot: raw.vaultRoot };
}

export async function writeHomeConfig(config: HomeConfig): Promise<void> {
  const configPath = homeConfigPath();
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
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

export function resolveVaultRoot(home: HomeConfig, override?: string): string {
  if (override) {
    return path.resolve(override);
  }
  if (process.env.GROUNDER_VAULT) {
    return path.resolve(process.env.GROUNDER_VAULT);
  }
  return path.resolve(home.vaultRoot);
}
