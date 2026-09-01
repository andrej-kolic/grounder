import { isInstallSchemaStale, readGrounderState } from "../connector/state.js";
import { ALL_AGENTS } from "./index.js";

/**
 * Whether any installed agent's on-disk artifacts are behind Grounder's
 * current command/hook schema versions — i.e. `grounder migrate` is needed.
 * Only looks at `~/.grounder/state.json` — does not open agent config files.
 *
 * If hooks were never enabled (no hooks version in state), that is not "out
 * of date" here. Doctor is the place that checks whether hook files exist on
 * disk. If state is missing or unreadable, stay quiet — doctor reports that.
 */
export async function schemaMigrateNeeded(homeDir?: string): Promise<boolean> {
  try {
    const state = await readGrounderState(homeDir);
    return isInstallSchemaStale(state, ALL_AGENTS);
  } catch {
    return false;
  }
}
