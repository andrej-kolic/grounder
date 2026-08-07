import { readGrounderState } from "../connector/state.js";
import { VERSION } from "../index.js";
import { packageVersionNotice } from "./package-version-notice.js";

/**
 * Stderr notice when the running package version and `state.json`'s
 * `grounderVersion` disagree (semver-ordered when both parse as x.y.z).
 * Prints on every command until migrate/vault init updates the ledger.
 * Silent on missing/corrupt state. Skip from `handoff peek` (session hooks),
 * `migrate`, and `vault init` (those refresh the ledger).
 */
export async function notifyUpgradeIfNeeded(homeDir?: string): Promise<void> {
  try {
    const state = await readGrounderState(homeDir);
    if (!state) {
      return;
    }
    const notice = packageVersionNotice(VERSION, state.grounderVersion);
    if (!notice) {
      return;
    }

    process.stderr.write(notice.banner);
  } catch {
    // Missing/corrupt state — doctor covers diagnostics.
  }
}
