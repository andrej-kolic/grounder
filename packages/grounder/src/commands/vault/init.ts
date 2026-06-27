import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  homeConfigPath,
  readHomeConfig,
  withHomeDir,
  writeHomeConfig,
} from "../../connector/home.js";
import {
  grounderNoteCommandPath,
  installGrounderNoteCommand,
} from "../../cursor/grounder-note.js";
import { projectsParent } from "../../vault/layout.js";
import { confirm } from "../../util/prompt.js";
import { flagBool, parseArgs } from "../../util/parse-args.js";

export interface VaultInitOptions {
  vaultPath: string;
  yes?: boolean;
  force?: boolean;
  homeDir?: string;
}

export async function runVaultInit(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const vaultPathArg = positional[0];
  const yes = flagBool(flags, "yes", "y");
  const force = flagBool(flags, "force", "f");

  if (!vaultPathArg) {
    process.stderr.write("Usage: grounder vault init <path>\n");
    return 1;
  }

  return runVaultInitWithOptions({
    vaultPath: vaultPathArg,
    yes,
    force,
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
    const commandPath = grounderNoteCommandPath(homeDir);

    process.stdout.write(`Vault root: ${vaultRoot}\n`);
    process.stdout.write("Will write:\n");
    process.stdout.write(`  home   ${homeConfigPath(homeDir)}\n`);
    process.stdout.write("  vault  10-Projects/ (if missing)\n");
    process.stdout.write(`  cursor ${commandPath}\n\n`);

    if (!yes) {
      const proceed = await confirm("Proceed?");
      if (!proceed) {
        process.stdout.write("Aborted.\n");
        return 0;
      }
    }

    if (existingHome && existingHome.vaultRoot !== vaultRoot && !force) {
      process.stderr.write(
        `Home config already exists with vault ${existingHome.vaultRoot}. Use --force to overwrite.\n`,
      );
      return 1;
    }

    await writeHomeConfig({ vaultRoot });
    await mkdir(projectsDir, { recursive: true });

    const commandResult = await installGrounderNoteCommand({
      force,
      homeDir,
    });

    process.stdout.write("✓ Wrote home config\n");
    process.stdout.write(`✓ Vault scaffold: ${projectsDir}\n`);
    if (commandResult === "skipped") {
      process.stdout.write("✓ Cursor command already exists (skipped)\n");
    } else {
      process.stdout.write(`✓ Installed Cursor command: ${commandPath}\n`);
    }

    return 0;
  });
}
