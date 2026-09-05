#!/usr/bin/env node
// Manual end-to-end smoke test for `~/.grounder/runtime` copy mode — the path
// bare `npx grounder setup ...` takes (docs/upgrading.md's documented "no
// install" option). `installHookRuntime` symlinks `dist/` for a durable
// source (a real checkout or global install) but *copies* it when the
// source looks ephemeral (an npx/pnpm-dlx cache, or anything under the OS
// temp dir). Copy mode needs `package.json` and `templates/` copied
// alongside `dist/` too (see hook-runtime.ts's `installHookRuntime` doc
// comment) — without them the materialized runtime crashed at import for
// every copy-mode user. A real checkout run (the other four scripts) always
// hits symlink mode, so this script forces copy mode two ways: running the
// built CLI from a copy of itself placed at a real npx-cache-shaped path
// (steps 1-2), and — a regression check for a real bug this script's own
// first draft hit — nested directly under `os.tmpdir()` instead (step 3; see
// `isEphemeralSource`'s doc comment in hook-runtime.ts for what that used to
// get wrong on macOS).
//
// Usage: pnpm build && node packages/e2e/scripts/e2e-copy-mode.mjs

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createChecker, createCliRunner, resolveCliPath, runE2eScript, section } from "./lib.mjs";

const builtCliPath = resolveCliPath(import.meta.url);
const packageRoot = path.dirname(path.dirname(builtCliPath)); // packages/grounder

// Isolated $HOME for this run — never touches the real ~/.grounder or ~/.cursor.
const home = mkdtempSync(path.join(os.tmpdir(), "grounder-copy-mode-home-"));
const vault = mkdtempSync(path.join(os.tmpdir(), "grounder-copy-mode-vault-"));

// A copy of the built package placed at a real npx cache path shape
// (~/.npm/_npx/<hash>/node_modules/grounder) — installHookRuntime's
// isEphemeralSource() check regex-matches `_npx` path segments regardless of
// where they live, reproducing "bare npx grounder setup" without an actual
// npx invocation. Nested under `home` so the shared cleanup/inspection logic
// in runE2eScript covers it.
const ephemeralPkgRoot = path.join(home, "_npx", "fake0123456789hash", "node_modules", "grounder");
mkdirSync(ephemeralPkgRoot, { recursive: true });
for (const entry of ["dist", "package.json", "templates"]) {
  cpSync(path.join(packageRoot, entry), path.join(ephemeralPkgRoot, entry), { recursive: true });
}
const ephemeralCliPath = path.join(ephemeralPkgRoot, "dist", "cli.js");

const env = { ...process.env, GROUNDER_HOME: home };
const runSetupCli = createCliRunner(ephemeralCliPath, env);
const checker = createChecker();

await runE2eScript(
  async () => {
    section("1. Real setup from an ephemeral-looking source (forces copy mode)");
    runSetupCli(["setup", vault, "--yes", "--agent", "cursor", "--hooks"]);

    const runtimeDir = path.join(home, ".grounder", "runtime");
    const manifest = JSON.parse(readFileSync(path.join(runtimeDir, "manifest.json"), "utf8"));
    checker.check("runtime materialized in copy mode", manifest.mode, "copy");
    checker.check(
      "runtime package.json copied alongside dist/",
      existsSync(path.join(runtimeDir, "package.json")),
      true,
    );
    checker.check(
      "runtime templates/ copied alongside dist/",
      existsSync(path.join(runtimeDir, "templates")),
      true,
    );

    section("2. Run the materialized runtime directly — must not crash at import");
    const runtimeCliPath = path.join(runtimeDir, "dist", "cli.js");
    const runRuntimeCli = createCliRunner(runtimeCliPath, env);
    runRuntimeCli(["handoff", "peek"]);

    // `status` reads its own output to check "Install: current" — captured
    // rather than inherited stdio, since this is the one call this script
    // actually asserts on, not just runs. `handoff peek`/`status` exiting 0
    // only proves dist/ imported cleanly; neither by itself proves
    // templates/ works. status's drift check (installDriftDetected ->
    // desiredArtifacts()) does read templates/ from *this* runtime's own
    // `<pkgRoot>/templates` unconditionally, though, so "Install: current"
    // (not "outdated") is real proof it read them successfully — an ENOENT
    // there would be caught by writeInstallStateLine and printed as
    // "State: invalid" instead, so the "Install: current" assertion below
    // would correctly fail this step rather than throwing uncaught.
    const statusOutput = execFileSync("node", [runtimeCliPath, "status"], {
      env,
      encoding: "utf8",
    });
    process.stdout.write(statusOutput);
    checker.check(
      "status resolved install drift via templates/ read from the materialized runtime",
      /Install:\s+current/.test(statusOutput),
      true,
    );

    section("3. Regression: nesting the source under os.tmpdir() also forces copy mode");
    // isEphemeralSource()'s tmpdir-prefix branch used to compare a
    // non-realpath'd path.resolve(os.tmpdir()) against Node's realpath'd
    // import.meta.url, silently mismatching on macOS's /var -> /private/var
    // symlink and falling through to symlink mode instead — this exact setup
    // (nested under `home`, itself under os.tmpdir(), with no `_npx` in the
    // path at all) is what caught that. Both sides are realpath'd now.
    const tmpdirPkgRoot = path.join(home, "tmpdir-mode-pkg-source");
    mkdirSync(tmpdirPkgRoot, { recursive: true });
    for (const entry of ["dist", "package.json", "templates"]) {
      cpSync(path.join(packageRoot, entry), path.join(tmpdirPkgRoot, entry), { recursive: true });
    }
    const tmpdirHome = path.join(home, "tmpdir-mode-home");
    const tmpdirVault = path.join(home, "tmpdir-mode-vault");
    mkdirSync(tmpdirHome, { recursive: true });
    mkdirSync(tmpdirVault, { recursive: true });
    const tmpdirEnv = { ...process.env, GROUNDER_HOME: tmpdirHome };
    createCliRunner(
      path.join(tmpdirPkgRoot, "dist", "cli.js"),
      tmpdirEnv,
    )(["setup", tmpdirVault, "--yes", "--agent", "cursor"]);
    const tmpdirManifest = JSON.parse(
      readFileSync(path.join(tmpdirHome, ".grounder", "runtime", "manifest.json"), "utf8"),
    );
    checker.check(
      "tmpdir-nested source also materialized in copy mode",
      tmpdirManifest.mode,
      "copy",
    );
  },
  { home, vault },
  checker,
);
