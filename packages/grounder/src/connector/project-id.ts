import { readFile } from "node:fs/promises";
import path from "node:path";
import { sanitizeProjectId } from "../util/project-id.js";

export type ProjectIdSource = "flag" | "package.json" | "git-remote" | "basename";

export interface DetectedProjectId {
  id: string;
  source: ProjectIdSource;
}

async function readPackageName(repoRoot: string): Promise<string | null> {
  const packagePath = path.join(repoRoot, "package.json");
  try {
    const raw = JSON.parse(await readFile(packagePath, "utf8")) as { name?: string };
    return typeof raw.name === "string" && raw.name.length > 0 ? raw.name : null;
  } catch {
    return null;
  }
}

function parseRemoteSlug(url: string): string | null {
  const trimmed = url.trim();
  const scpMatch = /^[^@]+@[^:]+:(.+)$/.exec(trimmed);
  const rawPath = scpMatch ? scpMatch[1] : trimmed.replace(/^[^:]+:\/\//, "");
  const lastSegment = rawPath.split("/").filter(Boolean).pop();
  if (!lastSegment) {
    return null;
  }
  return lastSegment.replace(/\.git$/i, "");
}

async function readGitRemoteSlug(repoRoot: string): Promise<string | null> {
  const configPath = path.join(repoRoot, ".git", "config");
  try {
    const contents = await readFile(configPath, "utf8");
    const lines = contents.split("\n");
    let inOrigin = false;

    for (const line of lines) {
      const section = /^\[remote "(.+)"\]$/.exec(line.trim());
      if (section) {
        inOrigin = section[1] === "origin";
        continue;
      }
      if (inOrigin) {
        const urlMatch = /^\s*url\s*=\s*(.+)$/.exec(line);
        if (urlMatch) {
          return parseRemoteSlug(urlMatch[1]);
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

export async function detectProjectId(
  repoRoot: string,
  override?: string,
): Promise<DetectedProjectId> {
  if (override) {
    const id = sanitizeProjectId(override);
    if (!id) {
      throw new Error(`Invalid project id: ${override}`);
    }
    return { id, source: "flag" };
  }

  const packageName = await readPackageName(repoRoot);
  if (packageName) {
    const id = sanitizeProjectId(packageName);
    if (id) {
      return { id, source: "package.json" };
    }
  }

  const remoteSlug = await readGitRemoteSlug(repoRoot);
  if (remoteSlug) {
    const id = sanitizeProjectId(remoteSlug);
    if (id) {
      return { id, source: "git-remote" };
    }
  }

  const basename = path.basename(repoRoot);
  const id = sanitizeProjectId(basename);
  if (!id) {
    throw new Error("Could not detect a valid project id");
  }

  return { id, source: "basename" };
}

export function formatProjectIdSource(source: ProjectIdSource): string {
  switch (source) {
    case "flag":
      return "from --id";
    case "package.json":
      return "from package.json";
    case "git-remote":
      return "from git remote";
    case "basename":
      return "from repo name";
  }
}
