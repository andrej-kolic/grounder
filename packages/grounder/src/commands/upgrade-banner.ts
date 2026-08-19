import { readGrounderState } from "../connector/state.js";
import { VERSION } from "../index.js";
import { packageVersionNotice } from "./package-version-notice.js";

/**
 * Stderr notice when the running Grounder version and the version stored for
 * this machine's configuration disagree (ordered by version when both look like
 * x.y.z). Prints on ordinary commands until migrate or setup updates state.
 * Silent if state is missing or broken. Skip for `handoff peek` (session hooks),
 * `migrate`, and `setup` (those update state themselves).
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
