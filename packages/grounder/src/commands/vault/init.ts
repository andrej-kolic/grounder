import { mkdir } from "node:fs/promises";
import { runtimeCliPath } from "../../agents/hook-runtime.js";
import { resolveAgents } from "../../agents/index.js";
import {
  type HomeConfig,
  homeConfigPath,
  readHomeConfig,
  withHomeDir,
  writeHomeConfig,
} from "../../connector/home.js";
import { helpExitCode } from "../../help.js";
import { flagBool, flagStrings, parseArgs } from "../../util/parse-args.js";
import { resolveUserPath } from "../../util/path.js";
import { confirm } from "../../util/prompt.js";
import { projectsParent } from "../../vault/layout.js";
import { applyAgentInstalls } from "../apply-agent-installs.js";

export interface VaultInitOptions {
  vaultPath: string;
  yes?: boolean;
  force?: boolean;
  /** Also install session-start teaser hooks for adapters that support them. */
  hooks?: boolean;
  dryRun?: boolean;
  homeDir?: string;
  /** Agent ids to install for. Defaults to auto-detecting installed agents. */
  agents?: string[];
}

/**
 * Read the existing home config for the "already exists with a different
 * vault" conflict check. A corrupt/invalid file has no value worth
 * conflict-checking (unlike `state.json`, which can encode forward-compat
 * schema info) — treat it as absent so `vault init` can recreate it without
 * requiring the user to manually delete it first, or doctor's plain
 * `grounder vault init <path>` hint would dead-end on the same parse error.
 */
async function readExistingHomeForInit(): Promise<{
  home: HomeConfig | null;
  invalidDetail: string | null;
}> {
  try {
    return { home: await readHomeConfig(), invalidDetail: null };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { home: null, invalidDetail: detail };
  }
}

export async function runVaultInit(argv: string[]): Promise<number> {
  const helpCode = helpExitCode(argv, "vault init");
  if (helpCode !== null) {
    return helpCode;
  }

  const { positional, flags, repeated } = parseArgs(argv);
  const vaultPathArg = positional[0];
  const yes = flagBool(flags, "yes", "y");
  const force = flagBool(flags, "force", "f");
  const hooks = flagBool(flags, "hooks");
  const dryRun = flagBool(flags, "dry-run");
  const agents = flagStrings(repeated, "agent");

  if (!vaultPathArg) {
    process.stderr.write("Usage: grounder vault init <path>\n");
    return 1;
  }

  return runVaultInitWithOptions({
    vaultPath: vaultPathArg,
    yes,
    force,
    hooks,
    dryRun,
    agents: agents.length > 0 ? agents : undefined,
  });
}

export async function runVaultInitWithOptions(options: VaultInitOptions): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const vaultRoot = resolveUserPath(options.vaultPath);
    const yes = options.yes ?? false;
    const force = options.force ?? false;
    const hooks = options.hooks ?? false;
    const dryRun = options.dryRun ?? false;
    const homeDir = options.homeDir;

    const { home: existingHome, invalidDetail } = await readExistingHomeForInit();
    const projectsDir = projectsParent(vaultRoot);
    const agents = await resolveAgents(options.agents);

    if (existingHome && existingHome.vaultRoot !== vaultRoot && !force) {
      process.stderr.write(
        `Home config already exists with vault ${existingHome.vaultRoot}. Use --force to overwrite.\n`,
      );
      return 1;
    }

    if (invalidDetail) {
      process.stdout.write(`Note: existing home config was invalid and will be replaced.\n`);
      process.stdout.write(`  ${invalidDetail}\n`);
    }
    process.stdout.write(`Vault root: ${vaultRoot}\n`);
    process.stdout.write("Connect to a markdown vault (once per machine).\n");
    if (dryRun) {
      process.stdout.write("Dry run — no files will be written.\n");
    }
    process.stdout.write("Will write:\n");
    process.stdout.write(`  home   ${homeConfigPath(homeDir)}\n`);
    process.stdout.write("  vault  10-Projects/ (if missing)\n");
    if (agents.length > 0) {
      // Shared across agents (slash commands + optional hooks) — list once.
      process.stdout.write(`  grounder runtime ${runtimeCliPath(homeDir)}\n`);
    }
    for (const agent of agents) {
      for (const artifactPath of agent.expectedArtifacts(homeDir)) {
        process.stdout.write(`  ${agent.id.padEnd(8)} ${artifactPath}\n`);
      }
      if (hooks && agent.expectedHookArtifacts) {
        for (const hookPath of agent.expectedHookArtifacts(homeDir)) {
          process.stdout.write(`  ${agent.id.padEnd(8)} hook ${hookPath}\n`);
        }
      }
    }
    if (agents.length === 0) {
      process.stdout.write("  (no supported agents detected — skipping agent artifacts)\n");
    }
    process.stdout.write("\n");

    if (dryRun) {
      return 0;
    }

    if (!yes) {
      const proceed = await confirm("Proceed?");
      if (!proceed) {
        process.stdout.write("Aborted.\n");
        return 0;
      }
    }

    await writeHomeConfig({ vaultRoot });
    await mkdir(projectsDir, { recursive: true });

    process.stdout.write("✓ Wrote home config\n");
    process.stdout.write(`✓ Vault scaffold: ${projectsDir}\n`);

    try {
      await applyAgentInstalls({
        agents,
        force,
        hooks,
        homeDir,
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `\nHome config and vault scaffold were written, but agent command files/hooks were not installed:\n  ${detail}\n`,
      );
      return 1;
    }

    return 0;
  });
}
