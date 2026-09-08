import path from "node:path";
import { currentBranch, findGitRoot } from "../connector/git.js";
import { type HomeConfig, homeConfigPath, readHomeConfig, withHomeDir } from "../connector/home.js";
import {
  findLinkedRepoRoot,
  type RepoConfig,
  readRepoConfig,
  repoConfigPath,
} from "../connector/repo.js";
import { readGrounderState, statePath } from "../connector/state.js";
import { isUnsupportedSchemaError } from "../connector/unsupported-schema.js";
import {
  resolveLogsDir,
  resolveNotesDir,
  resolvePlansDir,
  resolveProjectVaultRoot,
  resolveVaultRoot,
} from "../connector/vault.js";
import { helpExitCode } from "../help.js";
import { VERSION } from "../index.js";
import { flagBool, parseArgs } from "../util/parse-args.js";
import { installDriftDetected } from "./install-drift.js";
import { writeSection } from "./output.js";
import { type PackageVersionNotice, packageVersionNotice } from "./package-version-notice.js";

export interface StatusOptions {
  cwd?: string;
  homeDir?: string;
  json?: boolean;
}

const LABEL_WIDTH = 12;
const VAULT_INIT = "grounder setup <path>";
const REPO_INIT = "grounder link";
const REPO_INIT_FORCE = "grounder link --force";
const MIGRATE = "grounder migrate";
const MIGRATE_FORCE = "grounder migrate --force";
const UPGRADE_GROUNDER = "upgrade grounder";
const USAGE = "Usage: grounder status [--json]\n";

type MachineConfigState = "ok" | "missing" | "invalid";
type ProjectConfigState = "ok" | "missing" | "invalid" | "unsupported";
type StateStatus = "ok" | "missing" | "invalid" | "unsupported";

interface GatheredStateInfo {
  path: string;
  status: StateStatus;
  /** Full notice (present only when `status === "ok"` and versions disagree). */
  packageNotice: PackageVersionNotice | null;
  installCurrent: boolean | null;
}

interface GatheredMachine {
  configPath: string;
  configState: MachineConfigState;
  vaultRoot: string | null;
  state: GatheredStateInfo | null;
}

interface GatheredGit {
  root: string;
  branch: string | null;
}

interface GatheredProject {
  linked: boolean;
  folder: string | null;
  isAncestorLink: boolean;
  configPath: string | null;
  configState: ProjectConfigState;
  projectId: string | null;
  vaultRoot: string | null;
  notesDir: string | null;
  logsDir: string | null;
  plansDir: string | null;
  git: GatheredGit | null;
}

interface GatheredStatus {
  cwd: string;
  machine: GatheredMachine;
  project: GatheredProject;
}

function statusLine(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}\n`;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

async function gatherStateInfo(homeDir?: string): Promise<GatheredStateInfo> {
  try {
    const state = await readGrounderState(homeDir);
    if (!state) {
      return {
        path: statePath(homeDir),
        status: "missing",
        packageNotice: null,
        installCurrent: null,
      };
    }
    const notice = packageVersionNotice(VERSION, state.grounderVersion);
    const drift = await installDriftDetected(state, homeDir);
    return {
      path: statePath(homeDir),
      status: "ok",
      packageNotice: notice,
      installCurrent: !drift,
    };
  } catch (error: unknown) {
    return {
      path: statePath(homeDir),
      status: isUnsupportedSchemaError(error) ? "unsupported" : "invalid",
      packageNotice: null,
      installCurrent: null,
    };
  }
}

async function gatherMachine(
  homeInvalid: string | null,
  home: HomeConfig | null,
  homeDir?: string,
): Promise<GatheredMachine> {
  const configPath = homeConfigPath(homeDir);
  if (homeInvalid) {
    return { configPath, configState: "invalid", vaultRoot: null, state: null };
  }
  if (!home) {
    return { configPath, configState: "missing", vaultRoot: null, state: null };
  }
  return {
    configPath,
    configState: "ok",
    vaultRoot: resolveVaultRoot(home),
    state: await gatherStateInfo(homeDir),
  };
}

async function gatherGit(gitRoot: string | null): Promise<GatheredGit | null> {
  if (!gitRoot) {
    return null;
  }
  const branch = await currentBranch(gitRoot);
  return { root: gitRoot, branch: branch ?? null };
}

async function gatherProject(params: {
  cwd: string;
  gitRoot: string | null;
  linkedRoot: string | null;
  repo: RepoConfig | null;
  repoInvalid: string | null;
  repoUnsupported: boolean;
  home: HomeConfig | null;
}): Promise<GatheredProject> {
  const { cwd, gitRoot, linkedRoot, repo, repoInvalid, repoUnsupported, home } = params;

  if (!linkedRoot) {
    return {
      linked: false,
      folder: null,
      isAncestorLink: false,
      configPath: null,
      configState: "missing",
      projectId: null,
      vaultRoot: null,
      notesDir: null,
      logsDir: null,
      plansDir: null,
      git: null,
    };
  }

  const git = await gatherGit(gitRoot);
  const isAncestorLink = linkedRoot !== cwd;
  const configPath = repoConfigPath(linkedRoot);

  if (repoInvalid || !repo) {
    const configState: ProjectConfigState = repoUnsupported
      ? "unsupported"
      : repoInvalid
        ? "invalid"
        : "missing";
    return {
      linked: true,
      folder: linkedRoot,
      isAncestorLink,
      configPath,
      configState,
      projectId: null,
      vaultRoot: null,
      notesDir: null,
      logsDir: null,
      plansDir: null,
      git,
    };
  }

  return {
    linked: true,
    folder: linkedRoot,
    isAncestorLink,
    configPath,
    configState: "ok",
    projectId: repo.projectId,
    vaultRoot: home ? resolveProjectVaultRoot(home, repo) : null,
    notesDir: home ? resolveNotesDir(home, repo) : null,
    logsDir: home ? resolveLogsDir(home, repo) : null,
    plansDir: home ? resolvePlansDir(home, repo) : null,
    git,
  };
}

async function gatherStatus(options: StatusOptions): Promise<GatheredStatus> {
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

  const machine = await gatherMachine(homeInvalid, home, options.homeDir);
  const project = await gatherProject({
    cwd,
    gitRoot,
    linkedRoot,
    repo,
    repoInvalid,
    repoUnsupported,
    home,
  });

  return { cwd, machine, project };
}

/**
 * `findLinkedRepoRoot` walks up to the nearest `.grounder.json`, so a
 * subdirectory of a linked repo inherits that link. Surface it explicitly
 * when `linkedRoot` isn't `cwd` itself, so callers (agents included) don't
 * mistake an ancestor's link for this exact folder being linked.
 */
function writeAncestorNoteIfAny(cwd: string, folder: string): void {
  if (folder === cwd) {
    return;
  }
  process.stdout.write(
    statusLine(
      "Note:",
      `linked ancestor — ${cwd} itself is unlinked; grounder link here would create a separate project`,
    ),
  );
}

function writeGitLine(git: GatheredGit | null): void {
  if (!git) {
    return;
  }
  const value = git.branch !== null ? `${git.root}  (branch: ${git.branch})` : git.root;
  process.stdout.write(statusLine("Git:", value));
}

function writeStateLines(state: GatheredStateInfo): void {
  if (state.status === "missing") {
    process.stdout.write(statusLine("State:", `missing → ${MIGRATE_FORCE}`));
    return;
  }
  if (state.status === "unsupported") {
    process.stdout.write(statusLine("State:", `unsupported → ${UPGRADE_GROUNDER}`));
    return;
  }
  if (state.status === "invalid") {
    process.stdout.write(statusLine("State:", `invalid → ${MIGRATE_FORCE}`));
    return;
  }
  process.stdout.write(statusLine("State:", state.path));
  if (state.packageNotice) {
    process.stdout.write(statusLine("Package:", state.packageNotice.status));
  }
  process.stdout.write(
    statusLine("Install:", state.installCurrent ? "current" : `outdated → ${MIGRATE}`),
  );
}

function writeTextOutput(status: GatheredStatus): void {
  const { cwd, machine, project } = status;

  writeSection("Machine");
  if (machine.configState === "invalid") {
    process.stdout.write(statusLine("Config:", `invalid → ${VAULT_INIT}`));
  } else if (machine.configState === "missing") {
    process.stdout.write(statusLine("Config:", `missing → ${VAULT_INIT}`));
  } else {
    process.stdout.write(statusLine("Config:", machine.configPath));
    process.stdout.write(statusLine("Vault:", machine.vaultRoot as string));
    writeStateLines(machine.state as GatheredStateInfo);
  }

  process.stdout.write("\n");
  writeSection("Project");

  if (!project.linked) {
    process.stdout.write(statusLine("Linked:", "no"));
    if (machine.configState === "ok") {
      process.stdout.write(statusLine("Config:", `missing → ${REPO_INIT}`));
    }
    return;
  }

  const folder = project.folder as string;

  if (project.configState !== "ok") {
    const fix =
      project.configState === "unsupported"
        ? UPGRADE_GROUNDER
        : machine.configState === "ok"
          ? REPO_INIT_FORCE
          : VAULT_INIT;
    process.stdout.write(
      statusLine(
        "Linked:",
        project.configState === "unsupported" ? `unsupported → ${fix}` : `incomplete → ${fix}`,
      ),
    );
    process.stdout.write(statusLine("Folder:", folder));
    writeAncestorNoteIfAny(cwd, folder);
    process.stdout.write(
      statusLine(
        "Config:",
        project.configState === "unsupported"
          ? `unsupported → ${UPGRADE_GROUNDER}`
          : project.configState === "invalid"
            ? `invalid → ${REPO_INIT_FORCE}`
            : `missing → ${REPO_INIT}`,
      ),
    );
    writeGitLine(project.git);
    return;
  }

  process.stdout.write(statusLine("Linked:", "yes"));
  process.stdout.write(statusLine("Folder:", folder));
  writeAncestorNoteIfAny(cwd, folder);
  process.stdout.write(statusLine("Config:", project.configPath as string));
  process.stdout.write(statusLine("Id:", project.projectId as string));
  if (project.notesDir) {
    process.stdout.write(statusLine("In Vault:", project.vaultRoot as string));
    process.stdout.write(statusLine("Notes:", project.notesDir));
    process.stdout.write(statusLine("Logs:", project.logsDir as string));
    process.stdout.write(statusLine("Plans:", project.plansDir as string));
  }
  writeGitLine(project.git);
}

/**
 * Bump whenever `writeJsonOutput`'s payload shape changes (fields added,
 * removed, or renamed) — consumers (the VS Code extension's `status.ts`)
 * compare this directly instead of inferring compatibility structurally.
 */
export const STATUS_JSON_SCHEMA_VERSION = 1;

function writeJsonOutput(status: GatheredStatus): void {
  const { machine, project } = status;
  const payload = {
    schemaVersion: STATUS_JSON_SCHEMA_VERSION,
    machine: {
      configPath: machine.configPath,
      configState: machine.configState,
      vaultRoot: machine.vaultRoot,
      state: machine.state
        ? {
            path: machine.state.path,
            status: machine.state.status,
            packageVersionNotice: machine.state.packageNotice?.message ?? null,
            installCurrent: machine.state.installCurrent,
          }
        : null,
    },
    project: {
      linked: project.linked,
      folder: project.folder,
      isAncestorLink: project.isAncestorLink,
      configPath: project.configPath,
      configState: project.configState,
      projectId: project.projectId,
      vaultRoot: project.vaultRoot,
      notesDir: project.notesDir,
      logsDir: project.logsDir,
      plansDir: project.plansDir,
      git: project.git,
    },
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export async function runStatus(argv: string[]): Promise<number> {
  const helpCode = helpExitCode(argv, "status");
  if (helpCode !== null) {
    return helpCode;
  }

  const { positional, flags } = parseArgs(argv);
  if (positional.length > 0) {
    process.stderr.write(USAGE);
    return 1;
  }

  const allowedFlags = new Set(["json"]);
  for (const key of flags.keys()) {
    if (!allowedFlags.has(key)) {
      process.stderr.write(USAGE);
      return 1;
    }
  }

  return runStatusWithOptions({ json: flagBool(flags, "json") });
}

export async function runStatusWithOptions(options: StatusOptions = {}): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const status = await gatherStatus(options);
    if (options.json) {
      writeJsonOutput(status);
    } else {
      writeTextOutput(status);
    }
    return 0;
  });
}
