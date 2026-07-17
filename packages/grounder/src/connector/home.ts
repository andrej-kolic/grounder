import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileExists } from "../util/fs.js";

export interface HomeConfig {
  vaultRoot: string;
}

export function resolveHomeDir(override?: string): string {
  if (override) {
    return override;
  }
  return process.env.GROUNDER_HOME ?? os.homedir();
}

export function homeConfigPath(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".grounder", "config.json");
}

/**
 * Runs `fn` with home config resolved under `homeDir` (for tests/sandboxing).
 * Sets `GROUNDER_HOME` for the call, then restores it. No-op if `homeDir` is unset.
 */
export async function withHomeDir<T>(
  homeDir: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!homeDir) {
    return fn();
  }

  const previous = process.env.GROUNDER_HOME;
  process.env.GROUNDER_HOME = homeDir;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.GROUNDER_HOME;
    } else {
      process.env.GROUNDER_HOME = previous;
    }
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
