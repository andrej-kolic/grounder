import path from "node:path";
import { claude, cursor } from "../agents/index.js";
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
import { VERSION } from "../index.js";
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

/** Adapters known to this binary — schema compare only (no `isInstalled` I/O). */
const SCHEMA_AGENTS = [cursor, claude] as const;

function section(title: string): string {
  return `${title}\n`;
}

function statusLine(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}\n`;
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
      process.stdout.write(statusLine("State:", `missing → run: ${MIGRATE_FORCE}`));
      return;
    }
    process.stdout.write(statusLine("State:", statePath(homeDir)));
    const packageNotice = packageVersionNotice(VERSION, state.grounderVersion);
    if (packageNotice) {
      process.stdout.write(statusLine("Package:", packageNotice.status));
    }
    if (isInstallSchemaStale(state, SCHEMA_AGENTS)) {
      process.stdout.write(statusLine("Schemas:", `stale → run: ${MIGRATE}`));
    }
  } catch {
    process.stdout.write(statusLine("State:", `invalid → run: ${MIGRATE_FORCE}`));
  }
}

export async function runStatus(_argv: string[]): Promise<number> {
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

    process.stdout.write(section("Machine"));
    if (homeInvalid) {
      process.stdout.write(statusLine("Config:", `invalid → run: ${VAULT_INIT}`));
    } else if (!home) {
      process.stdout.write(statusLine("Config:", `missing → run: ${VAULT_INIT}`));
    } else {
      process.stdout.write(statusLine("Config:", homeConfigPath()));
      process.stdout.write(statusLine("Vault:", resolveVaultRoot(home)));
      await writeInstallStateLine(options.homeDir);
    }

    process.stdout.write("\n");
    process.stdout.write(section("Project"));

    if (!linkedRoot) {
      process.stdout.write(statusLine("Linked:", "no"));
      if (home) {
        process.stdout.write(statusLine("Config:", `missing → run: ${REPO_INIT}`));
      }
      return 0;
    }

    if (repoInvalid || !repo) {
      const fix = repoUnsupported ? UPGRADE_GROUNDER : home ? REPO_INIT_FORCE : VAULT_INIT;
      process.stdout.write(
        statusLine(
          "Linked:",
          repoUnsupported ? `unsupported → ${fix}` : `incomplete → run: ${fix}`,
        ),
      );
      process.stdout.write(statusLine("Folder:", linkedRoot));
      process.stdout.write(
        statusLine(
          "Config:",
          repoUnsupported
            ? `unsupported → ${UPGRADE_GROUNDER}`
            : repoInvalid
              ? `invalid → run: ${REPO_INIT_FORCE}`
              : `missing → run: ${REPO_INIT}`,
        ),
      );
      await writeGitLine(gitRoot);
      return 0;
    }

    if (!home) {
      process.stdout.write(statusLine("Linked:", `incomplete → run: ${VAULT_INIT}`));
      process.stdout.write(statusLine("Folder:", linkedRoot));
      process.stdout.write(statusLine("Config:", repoConfigPath(linkedRoot)));
      process.stdout.write(statusLine("Id:", repo.projectId));
      await writeGitLine(gitRoot);
      return 0;
    }

    process.stdout.write(statusLine("Linked:", "yes"));
    process.stdout.write(statusLine("Folder:", linkedRoot));
    process.stdout.write(statusLine("Config:", repoConfigPath(linkedRoot)));
    process.stdout.write(statusLine("Id:", repo.projectId));
    process.stdout.write(statusLine("Notes:", resolveNotesDir(home, repo)));
    process.stdout.write(statusLine("Logs:", resolveLogsDir(home, repo)));
    process.stdout.write(statusLine("Plans:", resolvePlansDir(home, repo)));
    await writeGitLine(gitRoot);

    return 0;
  });
}
