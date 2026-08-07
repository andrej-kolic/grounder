import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isGrounderPeekHookCommand, isHookRuntimeStale } from "../agents/hook-runtime.js";
import type { AgentAdapter } from "../agents/index.js";
import { resolveAgents } from "../agents/index.js";
import { findGitRoot } from "../connector/git.js";
import { homeConfigPath, readHomeConfig, withHomeDir } from "../connector/home.js";
import { findLinkedRepoRoot, readRepoConfig } from "../connector/repo.js";
import {
  type GrounderState,
  readGrounderState,
  recordedCommandsSchema,
  recordedHooksSchema,
  statePath,
} from "../connector/state.js";
import { isUnsupportedSchemaError } from "../connector/unsupported-schema.js";
import {
  resolveLogsDir,
  resolveNotesDir,
  resolvePlansDir,
  resolveVaultRoot,
} from "../connector/vault.js";
import { fileExists } from "../util/fs.js";
import { flagBool, parseArgs } from "../util/parse-args.js";
import { projectsParent } from "../vault/layout.js";
import { type CheckResult, failCheck, okCheck, warnCheck } from "./check.js";

export interface DoctorOptions {
  cwd?: string;
  homeDir?: string;
  /** Machine-only checks (skip project/link checks). */
  global?: boolean;
}

const VAULT_INIT = "grounder vault init <path>";
const MIGRATE = "grounder migrate";
const MIGRATE_FORCE = "grounder migrate --force";
const MIGRATE_HOOKS = "grounder migrate --hooks";
const REPO_INIT = "grounder init";
const UPGRADE_GROUNDER = "upgrade grounder";

/**
 * Commands installed before Grounder 0.3 have no per-file content hash, so
 * migrate cannot tell stock files from user edits — `--force` is required once.
 */
function commandsMigrateHint(recordedSchema: number): string {
  return recordedSchema === 0 ? MIGRATE_FORCE : MIGRATE;
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const info = await stat(dirPath);
    return info.isDirectory();
  } catch {
    return false;
  }
}

function formatCheck(check: CheckResult): string {
  const level = check.level.padEnd(4);
  const id = check.id.padEnd(18);
  const fix = check.fix ? ` → ${check.fix}` : "";
  return `  ${level}  ${id}  ${check.message}${fix}\n`;
}

function writeSection(title: string, checks: CheckResult[]): void {
  process.stdout.write(`${title}\n`);
  for (const check of checks) {
    process.stdout.write(formatCheck(check));
  }
}

function summarize(checks: CheckResult[]): string {
  const passed = checks.filter((c) => c.level === "ok").length;
  const failed = checks.filter((c) => c.level === "fail").length;
  const warned = checks.filter((c) => c.level === "warn").length;
  return `${passed} passed, ${failed} failed, ${warned} warned\n`;
}

async function checkHomeConfig(): Promise<{
  check: CheckResult;
  home: Awaited<ReturnType<typeof readHomeConfig>>;
}> {
  const configPath = homeConfigPath();
  if (!(await fileExists(configPath))) {
    return {
      check: failCheck("home-config", "home config missing", VAULT_INIT),
      home: null,
    };
  }

  try {
    const home = await readHomeConfig();
    if (!home) {
      return {
        check: failCheck("home-config", "home config missing", VAULT_INIT),
        home: null,
      };
    }
    return {
      check: okCheck("home-config", `home config present (${configPath})`),
      home,
    };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      check: failCheck("home-config", `home config invalid: ${detail}`, VAULT_INIT),
      home: null,
    };
  }
}

async function checkVault(home: Awaited<ReturnType<typeof readHomeConfig>>): Promise<{
  check: CheckResult;
  vaultRoot: string | null;
}> {
  if (!home) {
    return {
      check: failCheck("vault", "cannot resolve vault (no home config)", VAULT_INIT),
      vaultRoot: null,
    };
  }

  const vaultRoot = resolveVaultRoot(home);
  if (!(await isDirectory(vaultRoot))) {
    return {
      check: failCheck(
        "vault",
        `${vaultRoot} missing or not a directory`,
        "Fix path or re-run vault init",
      ),
      vaultRoot: null,
    };
  }

  return {
    check: okCheck("vault", `vault reachable (${vaultRoot})`),
    vaultRoot,
  };
}

async function checkProjectsDir(vaultRoot: string | null): Promise<CheckResult> {
  if (!vaultRoot) {
    return failCheck("projects-dir", "cannot check 10-Projects/ (no vault)", VAULT_INIT);
  }

  const projectsDir = projectsParent(vaultRoot);
  if (!(await isDirectory(projectsDir))) {
    return failCheck("projects-dir", `${projectsDir} missing`, `${VAULT_INIT} (idempotent)`);
  }

  return okCheck("projects-dir", `10-Projects/ present (${projectsDir})`);
}

/**
 * Load `~/.grounder/state.json` for doctor.
 * Missing → warn (legacy / pre-ledger); corrupt → fail; present → ok.
 */
async function loadInstallState(homeDir?: string): Promise<{
  state: GrounderState | null;
  check: CheckResult;
}> {
  const filePath = statePath(homeDir);
  try {
    const state = await readGrounderState(homeDir);
    if (!state) {
      return {
        state: null,
        check: warnCheck(
          "install-state",
          "install state missing (pre-ledger / never migrated)",
          MIGRATE_FORCE,
        ),
      };
    }
    return {
      state,
      check: okCheck("install-state", `install state present (${filePath})`),
    };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      state: null,
      check: failCheck(
        "install-state",
        `install state invalid: ${detail}`,
        `fix or remove ${filePath}, then ${MIGRATE_FORCE}`,
      ),
    };
  }
}

function commandsSchemaStale(
  agent: AgentAdapter,
  state: GrounderState | null,
  /** When false, state was unreadable — don't invent a schema-0 warn. */
  stateReadable: boolean,
): boolean {
  if (!stateReadable) {
    return false;
  }
  return recordedCommandsSchema(state, agent.id) < agent.commandsSchema;
}

function commandsSchemaAhead(
  agent: AgentAdapter,
  state: GrounderState | null,
  stateReadable: boolean,
): boolean {
  if (!stateReadable) {
    return false;
  }
  return recordedCommandsSchema(state, agent.id) > agent.commandsSchema;
}

function hooksSchemaStale(
  agent: AgentAdapter,
  state: GrounderState | null,
  stateReadable: boolean,
): boolean {
  if (!stateReadable || agent.hooksSchema === undefined) {
    return false;
  }
  return recordedHooksSchema(state, agent.id) < agent.hooksSchema;
}

function hooksSchemaAhead(
  agent: AgentAdapter,
  state: GrounderState | null,
  stateReadable: boolean,
): boolean {
  if (!stateReadable || agent.hooksSchema === undefined) {
    return false;
  }
  return recordedHooksSchema(state, agent.id) > agent.hooksSchema;
}

async function checkAgentArtifacts(
  state: GrounderState | null,
  stateReadable: boolean,
  homeDir?: string,
): Promise<CheckResult[]> {
  const agents = await resolveAgents();
  const checks: CheckResult[] = [];

  for (const agent of agents) {
    const expected = agent.expectedArtifacts(homeDir);
    const present = await Promise.all(expected.map((p) => fileExists(p)));
    const presentCount = present.filter(Boolean).length;
    const id = `agent-${agent.id}`;

    if (presentCount === expected.length) {
      if (commandsSchemaAhead(agent, state, stateReadable)) {
        const recorded = recordedCommandsSchema(state, agent.id);
        checks.push(
          failCheck(
            id,
            `${agent.name} commands schema newer than this grounder (recorded ${recorded}, supported ${agent.commandsSchema})`,
            UPGRADE_GROUNDER,
          ),
        );
      } else if (commandsSchemaStale(agent, state, stateReadable)) {
        const recorded = recordedCommandsSchema(state, agent.id);
        checks.push(
          warnCheck(
            id,
            `${agent.name} commands schema stale (recorded ${recorded}, current ${agent.commandsSchema}) — migrate`,
            commandsMigrateHint(recorded),
          ),
        );
      } else {
        checks.push(okCheck(id, `${agent.name} command files present`));
      }
      continue;
    }

    const fix = `${MIGRATE_FORCE} (or --agent=${agent.id})`;
    if (presentCount === 0) {
      checks.push(warnCheck(id, `${agent.name} detected but no Grounder command files`, fix));
    } else {
      const missing = expected.filter((_, i) => !present[i]);
      checks.push(
        failCheck(
          id,
          `${agent.name} missing ${missing.length} command file(s): ${missing.map((p) => path.basename(p)).join(", ")}`,
          fix,
        ),
      );
    }
  }

  return checks;
}

/** True when any nested `command` field is Grounder's peek hook (Cursor or Claude shape). */
function jsonContainsGrounderPeekCommand(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(jsonContainsGrounderPeekCommand);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (isGrounderPeekHookCommand(obj.command)) {
      return true;
    }
    return Object.values(obj).some(jsonContainsGrounderPeekCommand);
  }
  return false;
}

async function hookFileHasGrounderEntry(filePath: string): Promise<boolean> {
  try {
    if (!(await fileExists(filePath))) {
      return false;
    }
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return jsonContainsGrounderPeekCommand(parsed);
  } catch {
    return false;
  }
}

/**
 * Warn-only: session hooks are opt-in. Missing entry never fails doctor.
 * One check per detected agent that declares `expectedHookArtifacts`.
 *
 * Slash commands and session hooks both depend on the shared
 * `~/.grounder/runtime` materialization, so it's checked whenever *either* is
 * installed — stale mainly for bare-npx copy installs after an upgrade
 * (symlink installs stay current without re-init).
 */
async function checkAgentHooks(
  state: GrounderState | null,
  stateReadable: boolean,
  homeDir?: string,
): Promise<CheckResult[]> {
  const agents = await resolveAgents();
  const checks: CheckResult[] = [];
  let anyHooksInstalled = false;

  const commandsPresent = await Promise.all(
    agents.map((agent) => Promise.all(agent.expectedArtifacts(homeDir).map((p) => fileExists(p)))),
  );
  const anyCommandsInstalled = commandsPresent.some((present) => present.some(Boolean));

  for (const agent of agents) {
    if (!agent.expectedHookArtifacts) {
      continue;
    }

    const expected = agent.expectedHookArtifacts(homeDir);
    const present = await Promise.all(expected.map((p) => hookFileHasGrounderEntry(p)));
    const id = `agent-${agent.id}-hooks`;

    if (present.every(Boolean) && expected.length > 0) {
      anyHooksInstalled = true;
      if (hooksSchemaAhead(agent, state, stateReadable)) {
        const recorded = recordedHooksSchema(state, agent.id);
        checks.push(
          failCheck(
            id,
            `${agent.name} hooks schema newer than this grounder (recorded ${recorded}, supported ${agent.hooksSchema})`,
            UPGRADE_GROUNDER,
          ),
        );
      } else if (hooksSchemaStale(agent, state, stateReadable)) {
        const recorded = recordedHooksSchema(state, agent.id);
        checks.push(
          warnCheck(
            id,
            `${agent.name} hooks schema stale (recorded ${recorded}, current ${agent.hooksSchema}) — migrate`,
            MIGRATE,
          ),
        );
      } else {
        checks.push(okCheck(id, `${agent.name} session hook installed`));
      }
    } else {
      checks.push(
        warnCheck(id, `${agent.name} detected but no Grounder session hook`, MIGRATE_HOOKS),
      );
    }
  }

  if (anyHooksInstalled || anyCommandsInstalled) {
    if (await isHookRuntimeStale(homeDir)) {
      checks.push(
        warnCheck(
          "hook-runtime",
          "hook runtime stale or missing (re-run after upgrading, especially bare npx)",
          MIGRATE,
        ),
      );
    } else {
      checks.push(okCheck("hook-runtime", "hook runtime current"));
    }
  }

  return checks;
}

async function runMachineChecks(homeDir?: string): Promise<{
  checks: CheckResult[];
  home: Awaited<ReturnType<typeof readHomeConfig>>;
}> {
  const { check: homeCheck, home } = await checkHomeConfig();
  const { check: vaultCheck, vaultRoot } = await checkVault(home);
  const projectsCheck = await checkProjectsDir(vaultRoot);
  const { state, check: stateCheck } = await loadInstallState(homeDir);
  // Corrupt ledger: don't invent schema-0 migrate warns on top of the fail.
  const stateReadable = stateCheck.level !== "fail";
  const agentChecks = await checkAgentArtifacts(state, stateReadable, homeDir);
  const hookChecks = await checkAgentHooks(state, stateReadable, homeDir);

  return {
    checks: [homeCheck, vaultCheck, projectsCheck, stateCheck, ...agentChecks, ...hookChecks],
    home,
  };
}

async function runProjectChecks(
  cwd: string,
  home: Awaited<ReturnType<typeof readHomeConfig>>,
): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const gitRoot = await findGitRoot(cwd);
  const linkedRoot = await findLinkedRepoRoot(cwd, gitRoot);

  if (!linkedRoot) {
    checks.push(failCheck("repo-config", "no .grounder.json uptree", REPO_INIT));
    checks.push(
      failCheck("repo-config-valid", "cannot validate projectId (no repo config)", REPO_INIT),
    );
    checks.push(failCheck("notes-dir", "cannot resolve notes/ (no repo config)", REPO_INIT));
    checks.push(failCheck("logs-dir", "cannot resolve logs/ (no repo config)", REPO_INIT));
    checks.push(failCheck("plans-dir", "cannot resolve plans/ (no repo config)", REPO_INIT));
  } else {
    checks.push(
      okCheck("repo-config", `repo config present (${path.join(linkedRoot, ".grounder.json")})`),
    );

    let repo: Awaited<ReturnType<typeof readRepoConfig>> = null;
    let repoUnsupported = false;
    try {
      repo = await readRepoConfig(linkedRoot);
      if (!repo) {
        checks.push(
          failCheck(
            "repo-config-valid",
            "missing or invalid projectId",
            `Fix or re-run ${REPO_INIT} --force`,
          ),
        );
      } else {
        checks.push(okCheck("repo-config-valid", `projectId ok (${repo.projectId})`));
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      if (isUnsupportedSchemaError(error)) {
        repoUnsupported = true;
        checks.push(failCheck("repo-config-valid", detail, UPGRADE_GROUNDER));
      } else {
        checks.push(
          failCheck(
            "repo-config-valid",
            `invalid repo config: ${detail}`,
            `Fix or re-run ${REPO_INIT} --force`,
          ),
        );
      }
    }

    if (!home || !repo) {
      const reason = !home
        ? "no home config"
        : repoUnsupported
          ? "unsupported repo config version"
          : "no valid repo config";
      const fix = !home ? VAULT_INIT : repoUnsupported ? UPGRADE_GROUNDER : REPO_INIT;
      checks.push(failCheck("notes-dir", `cannot resolve notes/ (${reason})`, fix));
      checks.push(failCheck("logs-dir", `cannot resolve logs/ (${reason})`, fix));
      checks.push(failCheck("plans-dir", `cannot resolve plans/ (${reason})`, fix));
    } else {
      const notes = resolveNotesDir(home, repo);
      const logs = resolveLogsDir(home, repo);
      const plans = resolvePlansDir(home, repo);

      checks.push(
        (await isDirectory(notes))
          ? okCheck("notes-dir", `notes/ present (${notes})`)
          : failCheck("notes-dir", `${notes} missing`, `${REPO_INIT} (creates dirs)`),
      );
      checks.push(
        (await isDirectory(logs))
          ? okCheck("logs-dir", `logs/ present (${logs})`)
          : failCheck("logs-dir", `${logs} missing`, REPO_INIT),
      );
      checks.push(
        (await isDirectory(plans))
          ? okCheck("plans-dir", `plans/ present (${plans})`)
          : failCheck("plans-dir", `${plans} missing`, REPO_INIT),
      );
    }
  }

  if (!gitRoot) {
    checks.push(warnCheck("git", "no git repository found (optional)"));
  } else {
    checks.push(okCheck("git", `git root (${gitRoot})`));
  }

  return checks;
}

export async function runDoctor(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv);
  return runDoctorWithOptions({ global: flagBool(flags, "global") });
}

export async function runDoctorWithOptions(options: DoctorOptions = {}): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const { checks: machineChecks, home } = await runMachineChecks(options.homeDir);
    const projectChecks = options.global ? [] : await runProjectChecks(cwd, home);
    const checks = [...machineChecks, ...projectChecks];

    writeSection("Machine", machineChecks);
    if (!options.global) {
      process.stdout.write("\n");
      writeSection("Project", projectChecks);
    }
    process.stdout.write("\n");
    process.stdout.write(summarize(checks));

    return checks.some((c) => c.level === "fail") ? 1 : 0;
  });
}
