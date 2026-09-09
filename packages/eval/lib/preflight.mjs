import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { grounderCliPath } from "./sandbox.mjs";

/**
 * Fails fast if the machine's installed Grounder runtime is missing or
 * behind this checkout. Every probe here drives the *installed* CLI and
 * skill files (`~/.grounder/runtime`, `~/.cursor`/`~/.claude`), not the
 * checkout directly (see README's Isolation section) — a stale install
 * would silently grade yesterday's skill prompts against today's code.
 */
export async function assertRuntimeCurrent() {
  const cliPath = grounderCliPath();
  try {
    await access(cliPath);
  } catch {
    throw new Error(`Grounder runtime not found at ${cliPath}. Run \`pnpm grounder setup\` first.`);
  }

  const statusJson = await new Promise((resolve, reject) => {
    execFile("node", [cliPath, "status", "--json"], (error, stdout) => {
      if (error) {
        reject(new Error(`\`grounder status --json\` failed: ${error.message}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        reject(
          new Error(`Could not parse \`grounder status --json\` output: ${parseError.message}`),
        );
      }
    });
  });

  if (statusJson.machine?.state?.installCurrent === false) {
    throw new Error(
      "Grounder install is behind this checkout (`grounder status` reports " +
        "installCurrent: false). Run `grounder migrate` first — otherwise this " +
        "sweep grades the previously-installed skills, not the ones in this checkout.",
    );
  }
}
