// E2E smoke test for real process exit codes on argv/state edge cases.
// cli.ts's dispatch loop is `process.exit(await runX(rest))` — every command
// module itself just returns a number (see e.g. note.ts's empty-text guard
// returning 1). The in-process suite calls those functions directly and
// checks the returned number, which never actually proves cli.ts's
// `process.exit(code)` call propagates it as a real OS exit status on a
// spawned process — that's the one thing only a real CLI spawn can show.
// Uses createRawCliRunner (not createCliRunner), which doesn't throw on a
// non-zero exit — here that's the expected outcome under test, not a
// failure.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { envWithHome, resolveCliPath, useE2eHarness } from "./helpers.mjs";

const cliPath = resolveCliPath();
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const packageVersion = JSON.parse(
  readFileSync(path.join(repoRoot, "packages/grounder/package.json"), "utf8"),
).version;

test("real exit codes for argv/state edge cases", () => {
  const { home, vault, section, createRawCliRunner } = useE2eHarness("exit-codes");
  const runCliRaw = createRawCliRunner(cliPath, envWithHome(home));

  section("1. No args — synopsis, exit 0");
  const noArgs = runCliRaw([]);
  expect.soft(noArgs.status, "no-args exit code").toBe(0);
  expect.soft(noArgs.stdout, "no-args prints the synopsis").toContain("Global options:");

  section("2. -h — short synopsis, exit 0");
  const shortHelp = runCliRaw(["-h"]);
  expect.soft(shortHelp.status, "-h exit code").toBe(0);
  expect.soft(shortHelp.stdout, "-h prints the synopsis").toContain("Global options:");

  section("3. --help — full reference, exit 0");
  const fullHelp = runCliRaw(["--help"]);
  expect.soft(fullHelp.status, "--help exit code").toBe(0);
  expect.soft(fullHelp.stdout, "--help prints the full command reference").toContain("Commands:");

  section("4. -v / --version — real package version, exit 0");
  const version = runCliRaw(["-v"]);
  expect.soft(version.status, "-v exit code").toBe(0);
  expect
    .soft(version.stdout.trim(), "-v prints this build's real package.json version")
    .toBe(packageVersion);

  section("5. Unknown command — exit 1, stderr names it");
  const unknown = runCliRaw(["frobnicate"]);
  expect.soft(unknown.status, "unknown command exit code").toBe(1);
  expect
    .soft(unknown.stderr, "stderr names the unknown command")
    .toContain("Unknown command: frobnicate");

  section("6. note with no text — exit 1, usage on stderr");
  const emptyNote = runCliRaw(["note"]);
  expect.soft(emptyNote.status, "empty note exit code").toBe(1);
  expect.soft(emptyNote.stderr, "empty note prints usage").toContain("Usage: grounder note");

  section("7. link with no vault ever configured — exit 1");
  // Pinned for the same reason as step 8 below — link.ts computes
  // `findGitRoot(cwd)` unconditionally before the "no vault configured"
  // check, even though that check doesn't currently use it. Leaving `cwd`
  // unset only passes today because of that ordering; pin it so the
  // assertion doesn't silently start exercising a different code path
  // (this repo's own linked checkout) if that ordering ever changes.
  const unconfiguredLink = runCliRaw(["link", "--yes"], { cwd: home });
  expect.soft(unconfiguredLink.status, "unconfigured link exit code").toBe(1);
  expect
    .soft(unconfiguredLink.stderr, "unconfigured link tells the user to run setup")
    .toContain("No vault configured. Run: grounder setup <path>");

  section("8. note against a configured-but-unlinked project — exit 1");
  const setupForLinkCheck = runCliRaw(["setup", vault, "--yes"]);
  expect.soft(setupForLinkCheck.status, "setup for step 8 succeeded").toBe(0);
  // `cwd` must be pinned somewhere outside any git repo — `note` walks up
  // from `process.cwd()` looking for `.grounder.json` (see
  // commands/require-linked.ts), and left unset this child would inherit
  // *this test's own* cwd, which is inside the real (already-linked)
  // grounder repo. `home` (under os.tmpdir()) is guaranteed to have no
  // ancestor `.git` or `.grounder.json`.
  const unlinkedNote = runCliRaw(["note", "some text"], { cwd: home });
  expect.soft(unlinkedNote.status, "unlinked note exit code").toBe(1);
  expect
    .soft(unlinkedNote.stderr, "unlinked note tells the user to run link")
    .toContain("Folder not linked. Run: grounder link");
});
