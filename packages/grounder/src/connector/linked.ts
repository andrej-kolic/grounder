import { findGitRoot } from "./git.js";
import { type HomeConfig, readHomeConfig } from "./home.js";
import { findLinkedRepoRoot, type RepoConfig, readRepoConfig } from "./repo.js";

/** Home config + linked repo marker resolved from a cwd. */
export interface LinkedProject {
  home: HomeConfig;
  repo: RepoConfig;
  /** Directory that contains `.grounder.json`. */
  linkedRoot: string;
  /** Nearest git root when present. */
  gitRoot: string | null;
}

export type LinkedProjectError = "no-vault" | "not-linked";

export type ResolveLinkedProjectResult =
  | { ok: true; value: LinkedProject }
  | { ok: false; error: LinkedProjectError };

/**
 * Resolves home vault config and the linked project marker for `cwd`.
 * Does not write to stderr — callers map {@link LinkedProjectError} to UX.
 */
export async function resolveLinkedProject(cwd: string): Promise<ResolveLinkedProjectResult> {
  const home = await readHomeConfig();
  if (!home) {
    return { ok: false, error: "no-vault" };
  }

  const gitRoot = await findGitRoot(cwd);
  const linkedRoot = await findLinkedRepoRoot(cwd, gitRoot);
  if (!linkedRoot) {
    return { ok: false, error: "not-linked" };
  }

  const repo = await readRepoConfig(linkedRoot);
  if (!repo) {
    return { ok: false, error: "not-linked" };
  }

  return { ok: true, value: { home, repo, linkedRoot, gitRoot } };
}
