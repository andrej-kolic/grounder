import { readGrounderState } from "../connector/state.js";
import { VERSION } from "../index.js";

/**
 * Stderr notice when the running package is newer than `state.json`'s
 * `grounderVersion`. Prints on every command until migrate/vault init updates
 * the ledger. Silent on missing/corrupt state. Skip from `handoff peek`
 * (session hooks), `migrate`, and `vault init` (those refresh the ledger).
 */
export async function notifyUpgradeIfNeeded(homeDir?: string): Promise<void> {
  try {
    const state = await readGrounderState(homeDir);
    if (!state) {
      return;
    }
    if (state.grounderVersion === VERSION) {
      return;
    }

    process.stderr.write(`Grounder upgraded to ${VERSION} — run \`grounder migrate\`\n\n`);
  } catch {
    // Missing/corrupt state — doctor covers diagnostics.
  }
}
