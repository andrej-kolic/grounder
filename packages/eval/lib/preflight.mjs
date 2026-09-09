import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { grounderCliPath } from "./sandbox.mjs";

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * This checkout's own built CLI (`packages/grounder/dist/cli.js`) — deliberately
 * not the machine's installed runtime (`~/.grounder/runtime/dist/cli.js`), which
 * might be a symlink into this exact checkout (the normal dev setup) or might
 * not be (a different clone, a global npm install, a stale npx cache copy).
 * Only this checkout's own `desiredArtifacts()` is guaranteed to reflect this
 * branch's skill prompts.
 */
const CHECKOUT_CLI_PATH = path.resolve(LIB_DIR, "..", "..", "grounder", "dist", "cli.js");

/**
 * Fails fast if the machine's installed Grounder runtime is missing, or if
 * what's actually installed (`~/.cursor`/`~/.claude` skills, `~/.grounder`
 * runtime) doesn't match what this checkout's templates say it should be.
 * Every probe here drives the *installed* CLI and skill files, not the
 * checkout directly (see README's Isolation section) — a stale install would
 * silently grade yesterday's skill prompts against today's code.
 *
 * Status is read through the checkout's own `dist/cli.js`, not the installed
 * runtime: `state.json` (the ledger both would read) is one shared
 * machine-level file, so the only thing that changes is which templates
 * `installCurrent` gets compared against — and this branch's templates are
 * the ones that matter here, not whatever the installed runtime happens to
 * be symlinked or copied from.
 */
export async function assertRuntimeCurrent() {
  try {
    await access(grounderCliPath());
  } catch {
    throw new Error(
      `Grounder runtime not found at ${grounderCliPath()}. Run \`pnpm grounder setup\` first.`,
    );
  }
  try {
    await access(CHECKOUT_CLI_PATH);
  } catch {
    throw new Error(`Checkout CLI not built at ${CHECKOUT_CLI_PATH}. Run \`pnpm build\` first.`);
  }

  const statusJson = await new Promise((resolve, reject) => {
    execFile("node", [CHECKOUT_CLI_PATH, "status", "--json"], (error, stdout) => {
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

  // Anything other than an explicit `true` — `false`, `null` (missing/invalid
  // state.json), or a shape without `machine.state` at all — means we can't
  // vouch for the install, so it's not safe to run.
  if (statusJson.machine?.state?.installCurrent !== true) {
    throw new Error(
      "Grounder install is not confirmed current for this checkout (`grounder status` did not " +
        "report installCurrent: true). Run `grounder migrate` first — otherwise this sweep " +
        "grades whatever was previously installed, not this branch's skill prompts.",
    );
  }
}
