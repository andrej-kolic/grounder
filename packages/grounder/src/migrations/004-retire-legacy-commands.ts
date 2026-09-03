import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { resolveHomeDir } from "../connector/home.js";
import { forgetRecordedFile, recordedFileHash } from "../connector/state.js";
import { fileExists } from "../util/fs.js";
import { hashContent } from "../util/hash.js";
import type { Migration, MigrationArtifactResult, MigrationContext } from "./types.js";

const LEGACY_FILENAMES = [
  "grounder-note.md",
  "grounder-search.md",
  "grounder-plan.md",
  "grounder-task-handoff.md",
  "grounder-task.md",
] as const;

/**
 * Frozen historical fact about the schema-3 (pre-skill) install layout —
 * deliberately hardcoded, not derived from the live `expectedArtifacts()`
 * (which now returns schema-4 skill paths). Safe to delete this whole
 * migration later once schema-3 installs are assumed extinct in the wild —
 * a maintainer call, not something to automate via a version check.
 */
function legacyCommandArtifacts(agentId: string, homeDir?: string): string[] {
  const home = resolveHomeDir(homeDir);
  const dir =
    agentId === "claude"
      ? path.join(home, ".claude", "commands")
      : agentId === "cursor"
        ? path.join(home, ".cursor", "commands")
        : undefined;
  if (!dir) {
    return [];
  }
  return LEGACY_FILENAMES.map((filename) => path.join(dir, filename));
}

async function retireOne(
  agentId: string,
  filePath: string,
  ctx: MigrationContext,
): Promise<MigrationArtifactResult> {
  // Does the ledger have a hash recorded for this path?
  //
  // Checked up front so dry-run can report whether forgetting it would change
  // the ledger, without actually calling `forgetRecordedFile`. This mirrors
  // that function's own no-op check rather than reusing `wouldChangeGrounderState`
  // (state.ts), because that models a different write (`withAgentInstall`'s
  // merge-in-hashes), not a single-key delete like this one — reconcile the
  // two if forgetting ever grows past removing one key.
  const hasStaleHash = recordedFileHash(ctx.state, agentId, filePath) !== undefined;

  if (!(await fileExists(filePath))) {
    // File's already gone, but the ledger may still hold a stale hash for it
    // (e.g. removed outside `migrate`) — drop that entry so it doesn't linger.
    if (hasStaleHash && !ctx.dryRun) {
      await forgetRecordedFile(agentId, filePath, ctx.homeDir);
    }
    return { agentId, path: filePath, status: "already-absent", ledgerChanged: hasStaleHash };
  }

  const onDiskHash = hashContent(await readFile(filePath, "utf8"));
  const recorded = recordedFileHash(ctx.state, agentId, filePath);
  const safeToRetire = ctx.force || (recorded !== undefined && recorded === onDiskHash);

  if (!safeToRetire) {
    return { agentId, path: filePath, status: "left-modified", ledgerChanged: false };
  }

  if (!ctx.dryRun) {
    await unlink(filePath);
    // Deleted outright, not rewritten — recordAgentInstall's merge has no new
    // hash to overwrite this path with, so drop it explicitly or it lingers
    // in the ledger forever pointing at a file that no longer exists.
    if (hasStaleHash) {
      await forgetRecordedFile(agentId, filePath, ctx.homeDir);
    }
  }
  return { agentId, path: filePath, status: "retired", ledgerChanged: hasStaleHash };
}

export const retireLegacyCommands: Migration = {
  schemaVersion: 4,
  description: "Retire pre-skill grounder-*.md command files superseded by SKILL.md packaging",

  async run(ctx: MigrationContext): Promise<MigrationArtifactResult[]> {
    const results: MigrationArtifactResult[] = [];
    for (const agentId of ctx.agentIds) {
      for (const filePath of legacyCommandArtifacts(agentId, ctx.homeDir)) {
        results.push(await retireOne(agentId, filePath, ctx));
      }
    }
    return results;
  },
};
