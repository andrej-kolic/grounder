import { packageVersionNotice } from "../commands/package-version-notice.js";
import { isInstallSchemaStale, readGrounderState } from "../connector/state.js";
import { VERSION } from "../index.js";
import { ALL_AGENTS } from "./index.js";

/**
 * Whether `grounder migrate` is needed, per `~/.grounder/state.json` alone —
 * does not open agent config files. True when either:
 *  - an installed agent's on-disk artifacts are behind Grounder's current
 *    command/hook schema versions, or
 *  - the recorded `grounderVersion` disagrees with the running Grounder in a
 *    way `migrate` fixes (relation `ahead` or `differs` — a `behind` relation
 *    means this Grounder is older than the config and needs an *upgrade*
 *    instead, which is a different notice callers here don't surface).
 *
 * If hooks were never enabled (no hooks version in state), that is not "out
 * of date" here. Doctor is the place that checks whether hook files exist on
 * disk. If state is missing or unreadable, stay quiet — doctor reports that.
 */
export async function schemaMigrateNeeded(homeDir?: string): Promise<boolean> {
  try {
    const state = await readGrounderState(homeDir);
    if (isInstallSchemaStale(state, ALL_AGENTS)) {
      return true;
    }
    if (!state) {
      return false;
    }
    const notice = packageVersionNotice(VERSION, state.grounderVersion);
    return notice !== null && notice.relation !== "behind";
  } catch {
    return false;
  }
}
