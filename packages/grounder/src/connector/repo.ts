import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../util/fs.js";
import { UnsupportedSchemaError } from "./unsupported-schema.js";

export interface RepoConfig {
  version: 1;
  projectId: string;
}

/** Bump when `.grounder.json` shape changes; older binaries hard-stop on higher. */
export const SUPPORTED_REPO_VERSION = 1 as const;

const REPO_MARKER_FILE = ".grounder.json";

export function repoConfigPath(repoRoot: string): string {
  return path.join(repoRoot, REPO_MARKER_FILE);
}

export async function findLinkedRepoRoot(
  cwd: string,
  gitRoot: string | null = null,
): Promise<string | null> {
  let current = path.resolve(cwd);
  const stopAtGitRoot = gitRoot ? path.resolve(gitRoot) : null;

  while (true) {
    if (await fileExists(repoConfigPath(current))) {
      return current;
    }
    if (stopAtGitRoot && current === stopAtGitRoot) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

export async function readRepoConfig(repoRoot: string): Promise<RepoConfig | null> {
  const configPath = repoConfigPath(repoRoot);
  if (!(await fileExists(configPath))) {
    return null;
  }

  const raw = JSON.parse(await readFile(configPath, "utf8")) as Partial<RepoConfig>;
  if (typeof raw.version !== "number" || !Number.isInteger(raw.version)) {
    throw new Error(`Invalid repo config at ${configPath}: bad version`);
  }
  if (raw.version > SUPPORTED_REPO_VERSION) {
    throw new UnsupportedSchemaError(
      `Repo config at ${configPath} requires .grounder.json version ${raw.version}; this grounder supports ${SUPPORTED_REPO_VERSION}. Upgrade grounder.`,
    );
  }
  if (
    raw.version !== SUPPORTED_REPO_VERSION ||
    typeof raw.projectId !== "string" ||
    raw.projectId.length === 0
  ) {
    throw new Error(`Invalid repo config at ${configPath}`);
  }

  return { version: 1, projectId: raw.projectId };
}

export async function writeRepoConfig(repoRoot: string, config: RepoConfig): Promise<void> {
  const configPath = repoConfigPath(repoRoot);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
