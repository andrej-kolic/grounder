// Shared harness for the scripts/e2e-*.mjs smoke tests — resolving the built
// CLI, running it against an isolated $HOME, and the PASS/FAIL/cleanup
// contract every script reports. Not itself an `e2e-*.mjs` script, so
// `run-e2e.mjs`'s auto-discovery (`name.startsWith("e2e-")`) never picks it up.

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve `packages/grounder/dist/cli.js` relative to a script's own `import.meta.url`. */
export function resolveCliPath(importMetaUrl) {
  const repoRoot = path.join(path.dirname(fileURLToPath(importMetaUrl)), "..", "..", "..");
  const cliPath = path.join(repoRoot, "packages/grounder/dist/cli.js");
  if (!existsSync(cliPath)) {
    console.error(`Not built: ${cliPath} is missing. Run "pnpm build" first.`);
    process.exit(1);
  }
  return cliPath;
}

/** `stdio: "inherit"` so the real CLI output (setup/migrate tables) prints live. */
export function createCliRunner(cliPath, env) {
  return function runCli(args) {
    execFileSync("node", [cliPath, ...args], { env, stdio: "inherit" });
  };
}

// Banner between steps so script output (checks, state dumps) is visually
// separate from the real CLI's own output (tables, prompts) inlined below it.
export function section(title) {
  console.log(`\n=== ${title} ===`);
}

// Full file content is too long to dump on every PASS — just say how long it
// is; a FAIL still needs the real value, so print that one in full.
function summarize(value) {
  if (typeof value === "string" && value.length > 80) {
    return `<string, ${value.length} chars>`;
  }
  return JSON.stringify(value);
}

/** One `failed` flag shared by every `check()` call in a script. */
export function createChecker() {
  let failed = false;
  function check(label, actual, expected) {
    const pass = actual === expected;
    if (!pass) failed = true;
    console.log(
      `${pass ? "PASS" : "FAIL"}  ${label} (got: ${pass ? summarize(actual) : JSON.stringify(actual)})`,
    );
  }
  return {
    check,
    hadFailure: () => failed,
    markFailed: () => {
      failed = true;
    },
  };
}

/**
 * Run one e2e script's body under the shared PASS/FAIL/cleanup contract.
 * `runCli` uses `execFileSync`, which throws on a non-zero CLI exit — without
 * this `catch`, a crashed CLI step unwound straight to `finally` with
 * `failed` still `false`, so the script printed "Result: PASS" (and deleted
 * the temp dirs) for a run that never finished its checks.
 */
export async function runE2eScript(body, dirs, checker) {
  try {
    await body();
  } catch (err) {
    checker.markFailed();
    console.error(err instanceof Error ? err.message : String(err));
  } finally {
    const failed = checker.hadFailure();
    section(failed ? "Result: FAIL" : "Result: PASS");
    if (failed) {
      console.log(`Left state for inspection:\n  home:  ${dirs.home}\n  vault: ${dirs.vault}`);
    } else {
      rmSync(dirs.home, { recursive: true, force: true });
      rmSync(dirs.vault, { recursive: true, force: true });
      console.log("Cleaned up temp home/vault.");
    }
  }
  process.exit(checker.hadFailure() ? 1 : 0);
}
