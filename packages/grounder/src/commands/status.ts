import path from "node:path";
import { ALL_AGENTS } from "../agents/index.js";
import { currentBranch, findGitRoot } from "../connector/git.js";
import { type HomeConfig, homeConfigPath, readHomeConfig, withHomeDir } from "../connector/home.js";
import {
  findLinkedRepoRoot,
  type RepoConfig,
  readRepoConfig,
  repoConfigPath,
} from "../connector/repo.js";
import { isInstallSchemaStale, readGrounderState, statePath } from "../connector/state.js";
import { isUnsupportedSchemaError } from "../connector/unsupported-schema.js";
import {
  resolveLogsDir,
  resolveNotesDir,
  resolvePlansDir,
  resolveVaultRoot,
} from "../connector/vault.js";
import { helpExitCode } from "../help.js";
import { VERSION } from "../index.js";
import { writeSection } from "./output.js";
import { packageVersionNotice } from "./package-version-notice.js";

export interface StatusOptions {
  cwd?: string;
  homeDir?: string;
}

const LABEL_WIDTH = 12;
const VAULT_INIT = "grounder vault init <path>";
const REPO_INIT = "grounder init";
const REPO_INIT_FORCE = "grounder init --force";
const MIGRATE = "grounder migrate";
const MIGRATE_FORCE = "grounder migrate --force";
const UPGRADE_GROUNDER = "upgrade grounder";

function statusLine(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}\n`;
}

/**
 * `findLinkedRepoRoot` walks up to the nearest `.grounder.json`, so a
 * subdirectory of a linked repo inherits that link. Surface it explicitly
 * when `linkedRoot` isn't `cwd` itself, so callers (agents included) don't
 * mistake an ancestor's link for this exact folder being linked.
 */
function writeAncestorNoteIfAny(cwd: string, linkedRoot: string): void {
  if (linkedRoot === cwd) {
    return;
  }
  process.stdout.write(
    statusLine(
      "Note:",
      `linked ancestor — ${cwd} itself is unlinked; grounder init here would create a separate project`,
    ),
  );
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeGitLine(gitRoot: string | null): Promise<void> {
  if (!gitRoot) {
    return;
  }
  const branch = await currentBranch(gitRoot);
  const gitValue = branch !== undefined ? `${gitRoot}  (branch: ${branch})` : gitRoot;
  process.stdout.write(statusLine("Git:", gitValue));
}

async function tryReadHome(): Promise<{ home: HomeConfig | null; invalid: string | null }> {
  try {
    return { home: await readHomeConfig(), invalid: null };
  } catch (error: unknown) {
    return { home: null, invalid: errorDetail(error) };
  }
}

async function tryReadRepo(linkedRoot: string): Promise<{
  repo: RepoConfig | null;
  invalid: string | null;
  unsupported: boolean;
}> {
  try {
    return { repo: await readRepoConfig(linkedRoot), invalid: null, unsupported: false };
  } catch (error: unknown) {
    return {
      repo: null,
      invalid: errorDetail(error),
      unsupported: isUnsupportedSchemaError(error),
    };
  }
}

async function writeInstallStateLine(homeDir?: string): Promise<void> {
  try {
    const state = await readGrounderState(homeDir);
    if (!state) {
      process.stdout.write(statusLine("State:", `missing → ${MIGRATE_FORCE}`));
      return;
    }
    process.stdout.write(statusLine("State:", statePath(homeDir)));
    const packageNotice = packageVersionNotice(VERSION, state.grounderVersion);
    if (packageNotice) {
      process.stdout.write(statusLine("Package:", packageNotice.status));
    }
    if (isInstallSchemaStale(state, ALL_AGENTS)) {
      process.stdout.write(statusLine("Schemas:", `ledger stale → ${MIGRATE}`));
    } else {
      process.stdout.write(statusLine("Schemas:", "current"));
    }
  } catch {
    process.stdout.write(statusLine("State:", `invalid → ${MIGRATE_FORCE}`));
  }
}

export async function runStatus(argv: string[]): Promise<number> {
  const helpCode = helpExitCode(argv, "status");
  if (helpCode !== null) {
    return helpCode;
  }

  return runStatusWithOptions({});
}

export async function runStatusWithOptions(options: StatusOptions = {}): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const { home, invalid: homeInvalid } = await tryReadHome();
    const gitRoot = await findGitRoot(cwd);
    const linkedRoot = await findLinkedRepoRoot(cwd, gitRoot);
    const {
      repo,
      invalid: repoInvalid,
      unsupported: repoUnsupported,
    } = linkedRoot
      ? await tryReadRepo(linkedRoot)
      : { repo: null, invalid: null, unsupported: false };

    writeSection("Machine");
    if (homeInvalid) {
      process.stdout.write(statusLine("Config:", `invalid → ${VAULT_INIT}`));
    } else if (!home) {
      process.stdout.write(statusLine("Config:", `missing → ${VAULT_INIT}`));
    } else {
      process.stdout.write(statusLine("Config:", homeConfigPath()));
      process.stdout.write(statusLine("Vault:", resolveVaultRoot(home)));
      await writeInstallStateLine(options.homeDir);
    }

    process.stdout.write("\n");
    writeSection("Project");

    if (!linkedRoot) {
      process.stdout.write(statusLine("Linked:", "no"));
      if (home) {
        process.stdout.write(statusLine("Config:", `missing → ${REPO_INIT}`));
      }
      return 0;
    }

    if (repoInvalid || !repo) {
      const fix = repoUnsupported ? UPGRADE_GROUNDER : home ? REPO_INIT_FORCE : VAULT_INIT;
      process.stdout.write(
        statusLine("Linked:", repoUnsupported ? `unsupported → ${fix}` : `incomplete → ${fix}`),
      );
      process.stdout.write(statusLine("Folder:", linkedRoot));
      writeAncestorNoteIfAny(cwd, linkedRoot);
      process.stdout.write(
        statusLine(
          "Config:",
          repoUnsupported
            ? `unsupported → ${UPGRADE_GROUNDER}`
            : repoInvalid
              ? `invalid → ${REPO_INIT_FORCE}`
              : `missing → ${REPO_INIT}`,
        ),
      );
      await writeGitLine(gitRoot);
      return 0;
    }

    if (!home) {
      process.stdout.write(statusLine("Linked:", `incomplete → ${VAULT_INIT}`));
      process.stdout.write(statusLine("Folder:", linkedRoot));
      writeAncestorNoteIfAny(cwd, linkedRoot);
      process.stdout.write(statusLine("Config:", repoConfigPath(linkedRoot)));
      process.stdout.write(statusLine("Id:", repo.projectId));
      await writeGitLine(gitRoot);
      return 0;
    }

    process.stdout.write(statusLine("Linked:", "yes"));
    process.stdout.write(statusLine("Folder:", linkedRoot));
    writeAncestorNoteIfAny(cwd, linkedRoot);
    process.stdout.write(statusLine("Config:", repoConfigPath(linkedRoot)));
    process.stdout.write(statusLine("Id:", repo.projectId));
    process.stdout.write(statusLine("Notes:", resolveNotesDir(home, repo)));
    process.stdout.write(statusLine("Logs:", resolveLogsDir(home, repo)));
    process.stdout.write(statusLine("Plans:", resolvePlansDir(home, repo)));
    await writeGitLine(gitRoot);

    return 0;
  });
}
