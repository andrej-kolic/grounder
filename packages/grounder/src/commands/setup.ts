import { mkdir } from "node:fs/promises";
import { runtimeCliPath } from "../agents/hook-runtime.js";
import { resolveAgents } from "../agents/index.js";
import {
  type HomeConfig,
  homeConfigPath,
  InvalidHomeConfigError,
  readHomeConfig,
  withHomeDir,
  writeHomeConfig,
} from "../connector/home.js";
import { readGrounderState, statePath } from "../connector/state.js";
import { helpExitCode } from "../help.js";
import { VERSION } from "../index.js";
import { flagBool, flagStrings, parseArgs } from "../util/parse-args.js";
import { resolveUserPath } from "../util/path.js";
import { confirm } from "../util/prompt.js";
import { projectsParent } from "../vault/layout.js";
import { applyAgentInstalls } from "./apply.js";
import {
  renderModifiedNote,
  renderSummary,
  renderTable,
  rowsFromApplyResult,
  stateRow,
} from "./render-artifact-table.js";

export interface SetupOptions {
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
 * conflict-checking — treat it as absent so `setup` can recreate it without
 * requiring the user to manually delete it first.
 */
async function readExistingHomeForSetup(): Promise<{
  home: HomeConfig | null;
  invalidReason: string | null;
}> {
  try {
    return { home: await readHomeConfig(), invalidReason: null };
  } catch (error: unknown) {
    const reason =
      error instanceof InvalidHomeConfigError
        ? error.reason
        : error instanceof Error
          ? error.message
          : String(error);
    return { home: null, invalidReason: reason };
  }
}

export async function runSetup(argv: string[]): Promise<number> {
  const helpCode = helpExitCode(argv, "setup");
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
    process.stderr.write("Usage: grounder setup <path>\n");
    return 1;
  }

  return runSetupWithOptions({
    vaultPath: vaultPathArg,
    yes,
    force,
    hooks,
    dryRun,
    agents: agents.length > 0 ? agents : undefined,
  });
}

export async function runSetupWithOptions(options: SetupOptions): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const vaultRoot = resolveUserPath(options.vaultPath);
    const yes = options.yes ?? false;
    const force = options.force ?? false;
    const hooks = options.hooks ?? false;
    const dryRun = options.dryRun ?? false;
    const homeDir = options.homeDir;

    const { home: existingHome, invalidReason } = await readExistingHomeForSetup();
    const projectsDir = projectsParent(vaultRoot);
    const agents = await resolveAgents(options.agents);

    if (existingHome && existingHome.vaultRoot !== vaultRoot && !force) {
      process.stderr.write(
        `Home config already exists with vault ${existingHome.vaultRoot}. Use --force to overwrite.\n`,
      );
      return 1;
    }

    if (invalidReason) {
      process.stdout.write(
        dryRun
          ? `Would replace invalid home config (${invalidReason}).\n`
          : `Will replace invalid home config (${invalidReason}).\n`,
      );
    }
    process.stdout.write(`Vault root: ${vaultRoot}\n`);
    process.stdout.write("Connect to a markdown vault (once per machine).\n");
    process.stdout.write(dryRun ? "Would write:\n" : "Will write:\n");
    // One label column shared by every preview line — "runtime" (not "grounder
    // runtime") so it's no wider than it needs to be and lines up with the
    // agent ids instead of forcing its own, much wider, column.
    const previewLabelWidth = Math.max(
      "home".length,
      "vault".length,
      "runtime".length,
      ...agents.map((agent) => agent.id.length),
    );
    process.stdout.write(`  ${"home".padEnd(previewLabelWidth)} ${homeConfigPath(homeDir)}\n`);
    process.stdout.write(`  ${"vault".padEnd(previewLabelWidth)} 10-Projects/ (if missing)\n`);
    if (agents.length > 0) {
      process.stdout.write(`  ${"runtime".padEnd(previewLabelWidth)} ${runtimeCliPath(homeDir)}\n`);
    }
    for (const agent of agents) {
      const label = agent.id.padEnd(previewLabelWidth);
      for (const artifactPath of agent.expectedArtifacts(homeDir)) {
        process.stdout.write(`  ${label} ${artifactPath}\n`);
      }
      if (hooks && agent.expectedHookArtifacts) {
        for (const hookPath of agent.expectedHookArtifacts(homeDir)) {
          process.stdout.write(`  ${label} hook ${hookPath}\n`);
        }
      }
    }
    if (agents.length === 0) {
      process.stdout.write("  (no supported agents detected — skipping agent artifacts)\n");
    }
    process.stdout.write("\n");

    if (dryRun) {
      let priorState: Awaited<ReturnType<typeof readGrounderState>>;
      let applyResult: Awaited<ReturnType<typeof applyAgentInstalls>>;
      try {
        priorState = await readGrounderState(homeDir);
        applyResult = await applyAgentInstalls({
          agents,
          force,
          hooks,
          dryRun: true,
          homeDir,
          grounderVersion: VERSION,
        });
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Dry run failed: agent install would not succeed:\n  ${detail}\n`);
        return 1;
      }

      if (agents.length === 0) {
        return 0;
      }

      // A dry run never writes `~/.grounder/config.json` — if it doesn't
      // already exist (first-time setup, or one whose config is invalid and
      // would be replaced), `grounder migrate --force` would fail with "No
      // home config found" until this exact command is re-run without
      // `--dry-run`. Point the reader at that instead of a command that
      // can't work yet.
      const forceCommand = existingHome
        ? "grounder migrate"
        : `grounder setup ${options.vaultPath}`;
      reportAgentInstalls(applyResult, priorState, homeDir, true, forceCommand);
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

    let priorState: Awaited<ReturnType<typeof readGrounderState>>;
    let applyResult: Awaited<ReturnType<typeof applyAgentInstalls>>;
    try {
      priorState = await readGrounderState(homeDir);
      applyResult = await applyAgentInstalls({
        agents,
        force,
        hooks,
        homeDir,
        grounderVersion: VERSION,
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `\nHome config and vault scaffold were written, but agent skill files/hooks were not installed:\n  ${detail}\n`,
      );
      return 1;
    }

    if (agents.length === 0) {
      return 0;
    }

    // Real setup has already written a valid home config by this point
    // (above), so `grounder migrate --force` always works as the remediation
    // command here.
    reportAgentInstalls(applyResult, priorState, homeDir, false, "grounder migrate");
    return 0;
  });
}

/**
 * Render the table/summary/conflict-note block shared by a dry-run preview
 * and a real apply — same rows, same wording, only `renderSummary`'s tense
 * differs, so a dry run tells the truth about what a real run would show.
 */
function reportAgentInstalls(
  applyResult: Awaited<ReturnType<typeof applyAgentInstalls>>,
  priorState: Awaited<ReturnType<typeof readGrounderState>>,
  homeDir: string | undefined,
  dryRun: boolean,
  forceCommand: string,
): void {
  const rows = rowsFromApplyResult(applyResult);
  const ledgerChanged =
    applyResult.agents.some((a) => a.ledgerChanged) || VERSION !== priorState?.grounderVersion;
  rows.push(stateRow(ledgerChanged, priorState, statePath(homeDir)));

  process.stdout.write("\n");
  renderTable(rows);
  process.stdout.write("\n");
  renderSummary(rows, dryRun);
  renderModifiedNote(rows, forceCommand);
}
