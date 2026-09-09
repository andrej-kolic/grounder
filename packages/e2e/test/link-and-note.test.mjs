// E2E smoke test for the full project lifecycle: `grounder link` against a
// real git repo, followed by a real vault write via `grounder note`. None
// of the other e2e tests link a project at all — they only spawn `setup`/
// `migrate`/`status` against a bare $GROUNDER_HOME. `runLink`/`runNote`
// (commands/link.ts, commands/note.ts) resolve the project from
// `process.cwd()` — neither has a `--cwd` flag — so this is the only test
// that spawns the CLI with a real project `cwd`, catching wiring the
// in-process suite can't: git-root detection via a real spawned `git`
// subprocess, and cwd resolution carried correctly across two separate real
// process invocations (`link`, then `note`).

import { execFileSync } from "node:child_process";
import { cpSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { envWithHome, resolveCliPath, useE2eHarness } from "./helpers.mjs";

const cliPath = resolveCliPath();
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixtureRoot = path.join(repoRoot, "fixtures", "minimal-git-repo");

test("link detects the project and note writes into its vault folder", () => {
  const { home, vault, section, createCliRunner } = useE2eHarness("link-note");
  const env = envWithHome(home);
  const runCli = createCliRunner(cliPath, env);

  section("1. Real setup (vault must exist before link can find it)");
  runCli(["setup", vault, "--yes", "--agent", "cursor"]);

  section("2. Copy the fixture repo and git-init it");
  // fixtures/minimal-git-repo ships without its own `.git` (its README says
  // not to commit one there) — copy it out and git-init the copy, nested
  // under `home` so the harness's own cleanup/failure-inspection covers it
  // too, instead of mutating the tracked fixture in place.
  const repoDir = path.join(home, "project-repo");
  cpSync(fixtureRoot, repoDir, { recursive: true });
  // Just `init` — findGitRoot only checks for a `.git` entry, and nothing
  // here commits, so no git identity config is needed.
  execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });

  section("3. grounder link — real cwd + git-root detection, no --cwd flag exists");
  const linkOutput = runCli(["link", "--yes"], { cwd: repoDir });
  expect
    .soft(linkOutput, "link detected the project id from the fixture's package.json")
    .toContain("minimal-app (from package.json)");

  const marker = JSON.parse(readFileSync(path.join(repoDir, ".grounder.json"), "utf8"));
  expect
    .soft(marker.projectId, ".grounder.json records the detected project id")
    .toBe("minimal-app");

  section("4. grounder note — real vault write from the linked project's cwd");
  const noteOutput = runCli(
    [
      "note",
      "e2e coverage for grounder link",
      "--title",
      "e2e-link-note",
      "--topics",
      "link,vault",
    ],
    { cwd: repoDir },
  );
  const writtenPath = /^Wrote (.+)$/m.exec(noteOutput)?.[1];
  expect.soft(writtenPath, "note command printed the written path").toBeTruthy();
  if (!writtenPath) {
    // Can't check the file's location/content without a path — the soft
    // failure above already fails the test; bail out here rather than
    // letting readFileSync(undefined) throw a raw ERR_INVALID_ARG_TYPE that
    // buries the useful assertion message.
    return;
  }
  expect
    .soft(writtenPath, "note landed under the vault's minimal-app project folder")
    .toContain(path.join("10-Projects", "minimal-app", "notes"));

  const noteContent = readFileSync(writtenPath, "utf8");
  expect
    .soft(noteContent, "note body is the given text")
    .toContain("e2e coverage for grounder link");
  expect
    .soft(noteContent, "note frontmatter carries the given topics")
    .toContain('topics: ["link", "vault"]');
});
