import { mkdir } from "node:fs/promises";
import path from "node:path";
import { findGitRoot } from "../../connector/git.js";
import { readHomeConfig, withHomeDir } from "../../connector/home.js";
import { detectProjectId, formatProjectIdSource } from "../../connector/project-id.js";
import { readRepoConfig, repoConfigPath, writeRepoConfig } from "../../connector/repo.js";
import { resolveLogsDir, resolveNotesDir, resolveVaultRoot } from "../../connector/vault.js";
import { flagBool, flagString, parseArgs } from "../../util/parse-args.js";
import { resolveUserPath } from "../../util/path.js";
import { confirm } from "../../util/prompt.js";

export interface RepoInitOptions {
  cwd?: string;
  yes?: boolean;
  force?: boolean;
  id?: string;
  vault?: string;
  homeDir?: string;
}

export async function runRepoInit(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv);
  return runRepoInitWithOptions({
    yes: flagBool(flags, "yes", "y"),
    force: flagBool(flags, "force", "f"),
    id: flagString(flags, "id"),
    vault: flagString(flags, "vault"),
  });
}

export async function runRepoInitWithOptions(options: RepoInitOptions = {}): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const yes = options.yes ?? false;
    const force = options.force ?? false;
    const gitRoot = await findGitRoot(cwd);

    let home = await readHomeConfig();
    if (!home) {
      if (!options.vault) {
        process.stderr.write("No vault configured. Run: grounder vault init <path>\n");
        return 1;
      }
      home = { vaultRoot: resolveUserPath(options.vault) };
    }

    const vaultRoot = resolveVaultRoot(home, options.vault);
    const detected = await detectProjectId(cwd, options.id, gitRoot);
    const existingRepo = await readRepoConfig(cwd);
    const projectConfig = { version: 1 as const, projectId: detected.id };
    const notesDir = resolveNotesDir(home, projectConfig, options.vault);
    const logsDir = resolveLogsDir(home, projectConfig, options.vault);

    process.stdout.write(`✓ Folder:   ${cwd}\n`);
    if (gitRoot) {
      process.stdout.write(`✓ Git repo: ${gitRoot}\n`);
    }
    process.stdout.write(`✓ Vault:    ${vaultRoot}\n`);
    process.stdout.write(
      `✓ Project:  ${detected.id} (${formatProjectIdSource(detected.source)})\n\n`,
    );
    const notesDirRelative = path.relative(vaultRoot, notesDir);
    const logsDirRelative = path.relative(vaultRoot, logsDir);

    process.stdout.write("Will create:\n");
    process.stdout.write(`  link   ${repoConfigPath(cwd)}\n`);
    process.stdout.write(`  vault  ${notesDirRelative}/\n`);
    process.stdout.write(`  vault  ${logsDirRelative}/\n`);

    if (!yes) {
      const proceed = await confirm("Proceed?");
      if (!proceed) {
        process.stdout.write("Aborted.\n");
        return 0;
      }
    }

    if (existingRepo && !force) {
      if (existingRepo.projectId === detected.id) {
        process.stdout.write("✓ Already linked (skipped)\n");
        await mkdir(notesDir, { recursive: true });
        await mkdir(logsDir, { recursive: true });
        return 0;
      }

      process.stderr.write(
        `Folder already linked as ${existingRepo.projectId}. Use --force to overwrite.\n`,
      );
      return 1;
    }

    await writeRepoConfig(cwd, { version: 1, projectId: detected.id });
    await mkdir(notesDir, { recursive: true });
    await mkdir(logsDir, { recursive: true });

    process.stdout.write("✓ Wrote .grounder.json\n");
    process.stdout.write(`✓ Created notes folder: ${notesDir}\n`);
    process.stdout.write(`✓ Created logs folder: ${logsDir}\n`);
    return 0;
  });
}
