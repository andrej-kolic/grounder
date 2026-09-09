import { execFile } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * Scratch dirs a probe actually `cd`s into or writes under must live outside
 * this (or any) git repo. Confirmed via Cursor forum + staff response
 * (https://forum.cursor.com/t/agent-shell-working-directory-ignored-footer-reports-requested-cwd-workspace-is-a-git-subdirectory/168529):
 * "Any Shell command that runs inside the sandbox executes in the sandbox
 * workspace root and silently ignores working_directory" — cursor-agent
 * auto-detects the *enclosing* git repo as the workspace root and sandboxes
 * shell execution there, ignoring both cwd and an explicit `--workspace`, when
 * the given directory sits inside a larger git repo. Not fixed upstream as of
 * this writing. `os.tmpdir()` has no enclosing repo, so this doesn't trigger.
 */
const SCRATCH_ROOT = path.join(os.tmpdir(), "grounder-eval");

/** This machine's installed Grounder runtime CLI — the same one `{{GROUNDER_CLI}}` resolves to in installed skills. */
export function grounderCliPath() {
  return path.join(os.homedir(), ".grounder", "runtime", "dist", "cli.js");
}

/**
 * `process.env` plus `extra`, with `GROUNDER_VAULT` stripped. Vault
 * resolution (`resolveVaultRoot`) prefers `GROUNDER_VAULT` over the
 * sandbox's own `config.json`, so a maintainer with that var set in their
 * shell would otherwise have every sandboxed call silently read (search) or
 * write (mode-lock, handoff seeding) their real vault instead.
 */
export function sandboxEnv(extra) {
  const env = { ...process.env, ...extra };
  delete env.GROUNDER_VAULT;
  return env;
}

async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data));
}

/**
 * Sandbox for search probes: a disposable copy of the committed seeded
 * fixture vault (`fixtures/eval-vault`), wiped and recopied every run. The
 * probes only ever ask the model to search, but the CLI grants the model
 * unrestricted Bash — nothing stops it from also running `grounder note` or
 * similar, so the sandbox must be a throwaway copy, never the committed
 * fixture directly.
 */
export async function setupSearchSandbox() {
  const homeDir = path.join(SCRATCH_ROOT, "search-home");
  const repoDir = path.join(SCRATCH_ROOT, "search-repo");
  const vaultDir = path.join(SCRATCH_ROOT, "search-vault");
  const seedVaultDir = path.join(PKG_ROOT, "fixtures", "eval-vault");

  await rm(vaultDir, { recursive: true, force: true });
  await rm(repoDir, { recursive: true, force: true });
  await cp(seedVaultDir, vaultDir, { recursive: true });

  await writeJson(path.join(homeDir, ".grounder", "config.json"), { vaultRoot: vaultDir });
  await writeJson(path.join(repoDir, ".grounder.json"), { version: 1, projectId: "eval-search" });

  return { homeDir, repoDir, vaultDir };
}

/**
 * Sandbox for mode-lock probes: a disposable vault (handoff probes write to
 * it for real), seeded with two handoffs so recall probes have something to
 * load — including a `#2` selector. `writeUniqueMarkdown` never collides, so
 * parallel writes from
 * multiple models *within* one run are safe — but the vault itself is wiped
 * at the start of every run, so results from a previous run (more handoffs,
 * different titles) never bleed into this one.
 */
export async function setupModeLockSandbox() {
  const homeDir = path.join(SCRATCH_ROOT, "mode-lock-home");
  const repoDir = path.join(SCRATCH_ROOT, "mode-lock-repo");
  const vaultDir = path.join(SCRATCH_ROOT, "mode-lock-vault");

  await rm(vaultDir, { recursive: true, force: true });
  await rm(repoDir, { recursive: true, force: true });

  await writeJson(path.join(homeDir, ".grounder", "config.json"), { vaultRoot: vaultDir });
  await writeJson(path.join(repoDir, ".grounder.json"), {
    version: 1,
    projectId: "eval-mode-lock",
  });

  function seedBody(label) {
    return [
      `# Handoff: eval seed ${label}`,
      "",
      "## Next",
      "1. n/a",
      "",
      "## Blockers",
      "- None",
      "",
      "## Decisions",
      "- None",
      "",
      "## Files",
      "- None",
    ].join("\n");
  }

  async function seedHandoff(label) {
    await new Promise((resolve, reject) => {
      execFile(
        "node",
        [grounderCliPath(), "handoff", seedBody(label), "--title", `eval-seed-${label}`],
        { cwd: repoDir, env: sandboxEnv({ GROUNDER_HOME: homeDir }) },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  // Two seeds, so a `#2` selector probe (recall-flip-with-selector) has a
  // real second session to resolve instead of always hitting "only 1 exists".
  await seedHandoff(1);
  await seedHandoff(2);

  return { homeDir, repoDir, vaultDir };
}
