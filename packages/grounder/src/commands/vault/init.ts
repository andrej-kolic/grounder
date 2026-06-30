import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  homeConfigPath,
  readHomeConfig,
  withHomeDir,
  writeHomeConfig,
} from "../../connector/home.js";
import { resolveAgents } from "../../agents/index.js";
import { projectsParent, projectsJsonPath } from "../../vault/layout.js";
import { fileExists } from "../../util/fs.js";
import { confirm } from "../../util/prompt.js";
import { flagBool, flagStrings, parseArgs } from "../../util/parse-args.js";

export interface VaultInitOptions {
  vaultPath: string;
  yes?: boolean;
  force?: boolean;
  homeDir?: string;
  /** Agent ids to install for. Defaults to auto-detecting installed agents. */
  agents?: string[];
}

export async function runVaultInit(argv: string[]): Promise<number> {
  const { positional, flags, repeated } = parseArgs(argv);
  const vaultPathArg = positional[0];
  const yes = flagBool(flags, "yes", "y");
  const force = flagBool(flags, "force", "f");
  const agents = flagStrings(repeated, "agent");

  if (!vaultPathArg) {
    process.stderr.write("Usage: grounder vault init <path>\n");
    return 1;
  }

  return runVaultInitWithOptions({
    vaultPath: vaultPathArg,
    yes,
    force,
    agents: agents.length > 0 ? agents : undefined,
  });
}

export async function runVaultInitWithOptions(
  options: VaultInitOptions,
): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const vaultRoot = path.resolve(options.vaultPath);
    const yes = options.yes ?? false;
    const force = options.force ?? false;
    const homeDir = options.homeDir;

    const existingHome = await readHomeConfig();
    const projectsDir = projectsParent(vaultRoot);
    const agents = await resolveAgents(options.agents);

    if (existingHome && existingHome.vaultRoot !== vaultRoot && !force) {
      process.stderr.write(
        `Home config already exists with vault ${existingHome.vaultRoot}. Use --force to overwrite.\n`,
      );
      return 1;
    }

    process.stdout.write(`Vault root: ${vaultRoot}\n`);
    process.stdout.write("Will write:\n");
    process.stdout.write(`  home   ${homeConfigPath(homeDir)}\n`);
    process.stdout.write("  vault  10-Projects/ (if missing)\n");
    process.stdout.write("  vault  00-AI/projects.json (if missing)\n");
    for (const agent of agents) {
      process.stdout.write(`  ${agent.id.padEnd(8)} (${agent.name} artifacts)\n`);
    }
    if (agents.length === 0) {
      process.stdout.write("  (no supported agents detected — skipping agent artifacts)\n");
    }
    process.stdout.write("\n");

    if (!yes) {
      const proceed = await confirm("Proceed?");
      if (!proceed) {
        process.stdout.write("Aborted.\n");
        return 0;
      }
    }

    await writeHomeConfig({ vaultRoot });
    await mkdir(projectsDir, { recursive: true });

    const registryPath = projectsJsonPath(vaultRoot);
    const registryExisted = await fileExists(registryPath);
    if (!registryExisted) {
      await mkdir(path.dirname(registryPath), { recursive: true });
      await writeFile(registryPath, `${JSON.stringify({ projects: {} }, null, 2)}\n`, "utf8");
    }

    process.stdout.write("✓ Wrote home config\n");
    process.stdout.write(`✓ Vault scaffold: ${projectsDir}\n`);
    if (!registryExisted) {
      process.stdout.write(`✓ Created registry: ${registryPath}\n`);
    }

    for (const agent of agents) {
      const result = await agent.install({ force, homeDir });
      for (const [artifactPath, status] of Object.entries(result.artifacts)) {
        const label = status === "skipped" ? "already exists (skipped)" : `installed: ${artifactPath}`;
        process.stdout.write(`✓ ${agent.name} command ${label}\n`);
      }
      if (Object.keys(result.artifacts).length === 0) {
        process.stdout.write(`✓ ${agent.name}: no artifacts to install yet\n`);
      }
    }

    return 0;
  });
}
