import { isInstallSchemaStale, readGrounderState } from "../connector/state.js";
import { ALL_AGENTS } from "./index.js";

/**
 * Whether any installed agent's on-disk artifacts are behind Grounder's
 * current command/hook schema versions — i.e. `grounder migrate` is needed.
 * Only looks at `~/.grounder/state.json` — does not open agent config files.
 *
 * Schema-only by design — see "Schemas vs package version (keep separate)" in
 * docs/architecture/schema-versioning.md. Shared by `handoff peek` and
 * `grounder statusline`: both must never nag "run migrate" for a plain
 * package bump (that can also mean "upgrade Grounder", a different action the
 * CLI banner already owns) — and, since both run via the materialized
 * `~/.grounder/runtime` copy, a `grounderVersion`-based check can't reliably
 * see a newer Grounder anyway (the copy's baked `VERSION` and the recorded
 * `grounderVersion` are always stamped together by the same `setup`/`migrate`
 * run). See that doc for the fuller reasoning.
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
