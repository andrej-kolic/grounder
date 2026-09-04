/**
 * The I/O scaffolding both hook adapters run around their own merge functions:
 * read, converge, write, and report which of created/overwritten/skipped
 * happened. Kept out of `hook-fragment.ts` so that module stays pure — the
 * same split `reconcile/` draws between `core.ts` and `apply.ts`.
 *
 * What stays adapter-specific is the fragment shape itself: the recognizer
 * predicate, where a canonical entry belongs, and what "already converged"
 * means (Cursor: exactly one match in a flat array; Claude Code: exactly one
 * match, under the canonical matcher group). Those arrive here as callbacks.
 */

import { fileExists } from "../util/fs.js";
import { mergeJsonFile } from "../util/merge-json.js";
import { installHookRuntime } from "./hook-runtime.js";
import type { AgentInstallOptions, AgentInstallResult, ArtifactStatus } from "./types.js";

export interface HookFragmentInstall {
  /** The shared JSON config this fragment lives in. */
  dest: string;
  /**
   * Skip the write entirely — exactly one canonical entry is already present
   * *and* the shared runtime is current. Anything else converges.
   */
  isUpToDate(filePath: string): Promise<boolean>;
  /**
   * Does the file already list any Grounder entry (in any form, including a
   * legacy `npx` one)? Decides whether a write reports `overwritten` rather
   * than `created`. Only consulted when the file exists.
   */
  hasGrounderEntry(filePath: string): Promise<boolean>;
  /**
   * Converge the fragment into a parsed config root, returning the new root.
   * `fileExisted` is passed through for the one thing that depends on it
   * (Cursor stamps `version: 1` only onto a file it is creating).
   */
  merge(current: Record<string, unknown>, fileExisted: boolean): Record<string, unknown>;
}

/**
 * Install (or converge) a hook fragment, also materializing `~/.grounder/runtime`
 * on a real run. Always converges — no `--force` gate; `force` only affects
 * whole-file skill artifacts, never a shared-JSON fragment.
 *
 * Never clobbers: an unparseable config backs off inside {@link mergeJsonFile},
 * and a `merge` that refuses (see `readHooksObject`) throws before any write.
 */
export async function installHookFragment(
  install: HookFragmentInstall,
  opts: AgentInstallOptions,
): Promise<AgentInstallResult> {
  const dest = install.dest;

  if (await install.isUpToDate(dest)) {
    return { artifacts: { [dest]: "skipped" } };
  }

  if (!opts.dryRun) {
    await installHookRuntime({ homeDir: opts.homeDir });
  }

  const fileExisted = await fileExists(dest);
  const hadGrounderEntry = fileExisted && (await install.hasGrounderEntry(dest));
  const result = await mergeJsonFile(dest, (current) => install.merge(current, fileExisted), {
    dryRun: opts.dryRun,
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  const status: ArtifactStatus = !result.changed
    ? "skipped"
    : hadGrounderEntry
      ? "overwritten"
      : "created";
  return { artifacts: { [dest]: status } };
}

/**
 * Remove a hook fragment entirely (`--no-hooks`). Reports an artifact only
 * when something actually changed, so an agent that never had the entry
 * contributes no row to the install table.
 *
 * `remove` is expected to return its argument by reference when there is
 * nothing to remove — that is what stops {@link mergeJsonFile} from
 * reformatting an unrelated config file on its way to a no-op.
 */
export async function removeHookFragment(
  dest: string,
  remove: (current: Record<string, unknown>) => Record<string, unknown>,
  opts: AgentInstallOptions,
): Promise<AgentInstallResult> {
  if (!(await fileExists(dest))) {
    return { artifacts: {} };
  }
  const result = await mergeJsonFile(dest, remove, { dryRun: opts.dryRun });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.changed ? { artifacts: { [dest]: "overwritten" } } : { artifacts: {} };
}
