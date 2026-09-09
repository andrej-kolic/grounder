// E2E smoke test for `~/.grounder/runtime` copy mode — the path bare
// `npx grounder setup ...` takes (docs/upgrading.md's documented "no
// install" option). `installHookRuntime` symlinks `dist/` for a durable
// source (a real checkout or global install) but *copies* it when the
// source looks ephemeral (an npx/pnpm-dlx cache, or anything under the OS
// temp dir). Copy mode needs `package.json` and `templates/` copied
// alongside `dist/` too (see hook-runtime.ts's `installHookRuntime` doc
// comment) — without them the materialized runtime crashed at import for
// every copy-mode user. Every other e2e test always hits symlink mode
// (real checkout), so this test forces copy mode two ways: running the
// built CLI from a copy of itself placed at a real npx-cache-shaped path
// (steps 1-2), and — a regression check for a real bug this test's own
// first draft hit — nested directly under `os.tmpdir()` instead (step 3;
// see `isEphemeralSource`'s doc comment in hook-runtime.ts for what that
// used to get wrong on macOS).

import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { envWithHome, resolveCliPath, useE2eHarness } from "./helpers.mjs";

const builtCliPath = resolveCliPath();
const packageRoot = path.dirname(path.dirname(builtCliPath)); // packages/grounder

test("copy mode materializes a runnable runtime for an ephemeral-looking source", () => {
  const { home, vault, section, createCliRunner } = useE2eHarness("copy-mode");
  const env = envWithHome(home);

  section("1. Real setup from an ephemeral-looking source (forces copy mode)");
  // A copy of the built package placed at a real npx cache path shape
  // (~/.npm/_npx/<hash>/node_modules/grounder) — installHookRuntime's
  // isEphemeralSource() check regex-matches `_npx` path segments regardless
  // of where they live, reproducing "bare npx grounder setup" without an
  // actual npx invocation. Nested under `home` so useE2eHarness's cleanup /
  // failure-inspection covers it too.
  const ephemeralPkgRoot = path.join(
    home,
    "_npx",
    "fake0123456789hash",
    "node_modules",
    "grounder",
  );
  mkdirSync(ephemeralPkgRoot, { recursive: true });
  for (const entry of ["dist", "package.json", "templates"]) {
    cpSync(path.join(packageRoot, entry), path.join(ephemeralPkgRoot, entry), { recursive: true });
  }
  const ephemeralCliPath = path.join(ephemeralPkgRoot, "dist", "cli.js");
  const runSetupCli = createCliRunner(ephemeralCliPath, env);
  runSetupCli(["setup", vault, "--yes", "--agent", "cursor", "--hooks"]);

  const runtimeDir = path.join(home, ".grounder", "runtime");
  const manifest = JSON.parse(readFileSync(path.join(runtimeDir, "manifest.json"), "utf8"));
  expect.soft(manifest.mode, "runtime materialized in copy mode").toBe("copy");
  expect
    .soft(
      existsSync(path.join(runtimeDir, "package.json")),
      "runtime package.json copied alongside dist/",
    )
    .toBe(true);
  expect
    .soft(
      existsSync(path.join(runtimeDir, "templates")),
      "runtime templates/ copied alongside dist/",
    )
    .toBe(true);

  section("2. Run the materialized runtime directly — must not crash at import");
  const runtimeCliPath = path.join(runtimeDir, "dist", "cli.js");
  const runRuntimeCli = createCliRunner(runtimeCliPath, env);
  runRuntimeCli(["handoff", "peek"]);

  // `status`'s own output is checked for "Install: current", since this is
  // the one call this test actually asserts on, not just runs. `handoff
  // peek`/`status` exiting 0 only proves dist/ imported cleanly; neither by
  // itself proves templates/ works. status's drift check
  // (installDriftDetected -> desiredArtifacts()) does read templates/ from
  // *this* runtime's own `<pkgRoot>/templates` unconditionally, though, so
  // "Install: current" (not "outdated") is real proof it read them
  // successfully — an ENOENT there would be caught by
  // writeInstallStateLine and printed as "State: invalid" instead, so the
  // "Install: current" assertion below would correctly fail this step
  // rather than throwing uncaught.
  const statusOutput = runRuntimeCli(["status"]);
  expect
    .soft(
      statusOutput,
      "status resolved install drift via templates/ read from the materialized runtime",
    )
    .toMatch(/Install:\s+current/);

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
  const tmpdirEnv = envWithHome(tmpdirHome);
  createCliRunner(
    path.join(tmpdirPkgRoot, "dist", "cli.js"),
    tmpdirEnv,
  )(["setup", tmpdirVault, "--yes", "--agent", "cursor"]);
  const tmpdirManifest = JSON.parse(
    readFileSync(path.join(tmpdirHome, ".grounder", "runtime", "manifest.json"), "utf8"),
  );
  expect
    .soft(tmpdirManifest.mode, "tmpdir-nested source also materialized in copy mode")
    .toBe("copy");
});
