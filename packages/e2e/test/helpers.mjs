// Shared harness for the e2e vitest suite — resolving the built CLI, running
// it against an isolated $HOME, and per-test temp-dir cleanup. Kept out of
// `test/**/*.test.mjs` naming (no `*.test.mjs` suffix) so vitest never
// collects this file as a suite itself.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { onTestFinished } from "vitest";

// This file lives at packages/e2e/test/helpers.mjs, so up three levels is
// always the repo root, regardless of which test file imports it.
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Resolve `packages/grounder/dist/cli.js`, built by the `pnpm e2e` prerequisite. */
export function resolveCliPath() {
  const cliPath = path.join(repoRoot, "packages/grounder/dist/cli.js");
  if (!existsSync(cliPath)) {
    throw new Error(`Not built: ${cliPath} is missing. Run "pnpm build" first.`);
  }
  return cliPath;
}

/**
 * These mirror path conventions the real source computes (`statePath` in
 * connector/state.ts, `cursorHooksJsonPath` in agents/cursor.ts,
 * `claudeSettingsJsonPath` in agents/claude.ts) — as independently
 * hardcoded strings, not imports of those functions. The e2e suite never
 * imports from packages/grounder/src; it only spawns the built CLI, so
 * re-deriving the expected on-disk path here is part of what makes this a
 * black-box check instead of a tautology.
 */
// Named stateJsonPath, not statePath, since every test's own local variable
// for its result is already called `statePath`.
export function stateJsonPath(home) {
  return path.join(home, ".grounder", "state.json");
}

export function cursorHooksJsonPath(home) {
  return path.join(home, ".cursor", "hooks.json");
}

export function claudeSettingsJsonPath(home) {
  return path.join(home, ".claude", "settings.json");
}

/**
 * `GROUNDER_HOME` alone already routes every agent path (`.cursor/...`)
 * through the temp home — see `resolveHomeDir` in connector/home.ts. `HOME`
 * is set too anyway, matching packages/grounder/test/helpers.ts's
 * `withGroundedHome`: belt-and-suspenders against anything (a dependency, a
 * future code path) that falls back to bare `os.homedir()`, which matters
 * more now that vitest runs test files in parallel by default (the old
 * scripts/run-e2e.mjs ran them one at a time).
 */
export function envWithHome(home) {
  return { ...process.env, GROUNDER_HOME: home, HOME: home };
}

/**
 * Isolated $HOME/vault temp dirs plus a diagnostic-output buffer for one
 * test, registered against the currently-running test via vitest's
 * `onTestFinished`.
 *
 * On a passing run nothing is printed — matches the rest of the quality
 * gate staying quiet when green. On failure, everything buffered via
 * `log`/`section`/a `createCliRunner`(`Raw`) runner (real CLI stdout+stderr
 * included) is flushed, and the temp dirs are left on disk (path printed)
 * instead of cleaned up, so a failure can be inspected after the fact.
 *
 * Both dump-on-failure and cleanup-on-success live in this one
 * `onTestFinished` callback, not split across `onTestFinished`/
 * `onTestFailed`: `@vitest/runner`'s `runTest` calls `test.onFinished`
 * hooks *before* `test.onFailed` ones (chunk-artifact.js, `callTestHooks`
 * for `onFinished` runs first, `onFailed` second, both gated on
 * `test.result.state`). A separate `onTestFailed` cleanup guard would
 * always see the pre-failure `false`, deleting the temp dirs before the
 * "left for inspection" message even prints. `test.result.state` (read
 * here via `ctx.task.result.state`) is already finalized by the time
 * `onFinished` runs, so a single hook branching on it is both correct and
 * simpler.
 */
export function useE2eHarness(prefix) {
  const home = mkdtempSync(path.join(os.tmpdir(), `grounder-${prefix}-home-`));
  const vault = mkdtempSync(path.join(os.tmpdir(), `grounder-${prefix}-vault-`));
  const buffer = [];

  function log(text) {
    buffer.push(text);
  }

  // Banner between steps so CLI output (setup/migrate tables) stays legible
  // once flushed, instead of one undifferentiated wall of text.
  function section(title) {
    log(`\n=== ${title} ===\n`);
  }

  // spawnSync (not execFileSync) so stderr is captured into the buffer too,
  // on both success and failure — execFileSync's return value is stdout
  // only, and Node inherits its stderr straight to the real terminal by
  // default (upgrade banners, warnings), which would leak on a passing run.
  //
  // `cwd` defaults to unset (inherits this process's cwd) — pass it for
  // commands like `link`/`note` that resolve the project from `process.cwd()`
  // with no `--cwd` flag of their own (see commands/link.ts, commands/note.ts).
  function spawnCli(cliPath, args, env, cwd) {
    const result = spawnSync("node", [cliPath, ...args], { env, cwd, encoding: "utf8" });
    if (result.stdout) log(result.stdout);
    if (result.stderr) log(result.stderr);
    return result;
  }

  // Throws on a non-zero exit or a spawn error — for the common case where a
  // failed CLI call is itself a test failure, not something under test.
  // Returns the captured stdout, for the rare caller (e.g. copy-mode's
  // `status` check) that asserts on the CLI's own output rather than just
  // running it for a file-system side effect.
  function createCliRunner(cliPath, env) {
    return function runCli(args, { cwd } = {}) {
      const result = spawnCli(cliPath, args, env, cwd);
      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error(`node ${cliPath} ${args.join(" ")} exited with status ${result.status}`);
      }
      return result.stdout;
    };
  }

  // Never throws on a non-zero exit — for tests that assert on the exit
  // code/stderr of a call that's *expected* to fail (bad argv, an unlinked
  // project, ...). Returns { stdout, stderr, status } instead of just
  // stdout, since the exit code and stderr are usually exactly what these
  // tests check.
  function createRawCliRunner(cliPath, env) {
    return function runCliRaw(args, { cwd } = {}) {
      const result = spawnCli(cliPath, args, env, cwd);
      if (result.error) {
        throw result.error;
      }
      return { stdout: result.stdout, stderr: result.stderr, status: result.status };
    };
  }

  onTestFinished((ctx) => {
    if (ctx.task.result?.state === "fail") {
      console.log(buffer.join(""));
      console.log(`Left state for inspection:\n  home:  ${home}\n  vault: ${vault}`);
    } else {
      rmSync(home, { recursive: true, force: true });
      rmSync(vault, { recursive: true, force: true });
    }
  });

  return { home, vault, log, section, createCliRunner, createRawCliRunner };
}
