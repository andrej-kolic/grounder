import { unlink } from "node:fs/promises";
import { forgetLedgerFile, setLedgerFileHash } from "../connector/state.js";
import { writeFileAtomic } from "../util/fs.js";
import { hashContent } from "../util/hash.js";
import { isUnderOwnedPrefix, type PlanEntry } from "./core.js";

export interface ApplyPlanOptions {
  agentId: string;
  plan: readonly PlanEntry[];
  /** Desired content for `create`/`update`/`noop` entries — path → rendered bytes. */
  content: Record<string, string>;
  grounderVersion: string;
  homeDir?: string;
  /**
   * Directories this agent is allowed to write into / delete from (its own
   * `AgentAdapter#ownedPrefixes`) — re-checked here via
   * {@link isUnderOwnedPrefix}, not trusted solely from the caller, so a plan
   * built from a stray/corrupted ledger entry can never be applied as a
   * filesystem write outside the agent's own tree.
   */
  ownedPrefixes: readonly string[];
}

/**
 * Execute a whole-file plan: write/delete each path, and persist that path's
 * ledger hash right after its own file write succeeds (per-artifact, not
 * batched) — a mid-run crash leaves the ledger consistent with whatever
 * actually completed.
 *
 * Returns nothing: callers render their tables from the `PlanEntry[]` they
 * passed in (see `commands/render-artifact-table.ts`'s
 * `rowStatusFromPlanAction`), so a second per-path outcome vocabulary here
 * would only be a chance for the two to disagree. Failure is a throw, not a
 * status — every entry that doesn't throw did exactly what its action says.
 */
export async function applyPlan(opts: ApplyPlanOptions): Promise<void> {
  for (const entry of opts.plan) {
    if (
      (entry.action === "create" || entry.action === "update" || entry.action === "delete") &&
      !isUnderOwnedPrefix(entry.path, opts.ownedPrefixes)
    ) {
      throw new Error(
        `Refusing to ${entry.action} ${entry.path}: outside ${opts.agentId}'s owned prefixes`,
      );
    }

    switch (entry.action) {
      case "create":
      case "update": {
        const content = opts.content[entry.path];
        if (content === undefined) {
          throw new Error(`No desired content for ${entry.path} (action: ${entry.action})`);
        }
        await writeFileAtomic(entry.path, content);
        await setLedgerFileHash({
          agentId: opts.agentId,
          filePath: entry.path,
          hash: hashContent(content),
          grounderVersion: opts.grounderVersion,
          homeDir: opts.homeDir,
        });
        break;
      }
      case "noop": {
        // A desired path already matching on disk — hydrate the ledger hash
        // when it wasn't recorded yet (or recorded stale), so a manually
        // correct file becomes safely Grounder-managed going forward.
        const content = opts.content[entry.path];
        if (content !== undefined) {
          await setLedgerFileHash({
            agentId: opts.agentId,
            filePath: entry.path,
            hash: hashContent(content),
            grounderVersion: opts.grounderVersion,
            homeDir: opts.homeDir,
          });
        }
        break;
      }
      case "delete": {
        try {
          await unlink(entry.path);
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            // A real failure (EACCES, EISDIR, …) — propagate rather than
            // forgetting the ledger hash for a file that's still on disk;
            // swallowing it here would leave the ledger and disk permanently
            // disagreeing, with no way for a future run to notice and retry.
            throw error;
          }
        }
        await forgetLedgerFile({
          agentId: opts.agentId,
          filePath: entry.path,
          grounderVersion: opts.grounderVersion,
          homeDir: opts.homeDir,
        });
        break;
      }
      case "forget": {
        // Already gone from disk, but the ledger still holds a stale hash
        // (removed outside `migrate`) — drop it so it doesn't linger forever.
        await forgetLedgerFile({
          agentId: opts.agentId,
          filePath: entry.path,
          grounderVersion: opts.grounderVersion,
          homeDir: opts.homeDir,
        });
        break;
      }
      case "conflict":
        // Left alone on purpose — on-disk content Grounder can't confirm it
        // wrote. `--force` is what turns this into an `update`/`delete`
        // upstream in `reconcile()`, so there is nothing to do here.
        break;
    }
  }
}
