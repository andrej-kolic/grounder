import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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

/**
 * Opaque key identifying one (model, probe) run's scratch dir. Grading
 * regexes do an unanchored substring search over whole command strings,
 * which include this key whenever the model runs something like `ls` on its
 * own cwd — a human-readable key built from the probe id (e.g.
 * "recall-flip-to-handoff") would then match its *own* forbidden pattern by
 * just appearing in a path, not because the model actually crossed
 * anything (caught live: this exact probe false-failed the run right after
 * switching to per-probe sandboxes). A hex digest can't spell "handoff",
 * "recall", "list", or "peek" — none of those words are hex-alphabet-only —
 * so it can't collide.
 */
export function sandboxKey(modelEntry, probe) {
  return createHash("sha1").update(`${modelEntry.label}::${probe.id}`).digest("hex").slice(0, 16);
}

async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data));
}

/** Best-effort recursive chmod — tolerates the path not existing yet (nothing to fix up). */
function chmodRecursiveBestEffort(dir, mode) {
  return new Promise((resolve) => {
    execFile("chmod", ["-R", mode, dir], () => resolve());
  });
}

/** Recursive chmod that must succeed — used where a failure means the sandbox isn't actually locked down. */
function chmodRecursive(dir, mode) {
  return new Promise((resolve, reject) => {
    execFile("chmod", ["-R", mode, dir], (error) => (error ? reject(error) : resolve()));
  });
}

/**
 * Shared sandbox state for search probes: a disposable copy of the
 * committed seeded fixture vault (`fixtures/eval-vault`), wiped and
 * recopied once per sweep, then locked read-only. Safe to share across
 * every concurrent probe in the sweep *because* it's read-only — nothing
 * left for one probe to mutate that a sibling would then grade against.
 * The CLI grants the model unrestricted Bash, so nothing stops it from also
 * running `grounder note` (or `rm`) — hence a throwaway copy, never the
 * committed fixture directly, and hence the lock. Call once per sweep; call
 * {@link setupSearchRepoDir} per probe for the part that must be unique.
 */
export async function setupSearchSandbox() {
  const homeDir = path.join(SCRATCH_ROOT, "search-home");
  const vaultDir = path.join(SCRATCH_ROOT, "search-vault");
  const seedVaultDir = path.join(PKG_ROOT, "fixtures", "eval-vault");

  // Undo last run's read-only lock first — `rm` needs write permission on
  // every directory it deletes from, not just the files themselves.
  await chmodRecursiveBestEffort(vaultDir, "u+w");
  await rm(vaultDir, { recursive: true, force: true });
  await cp(seedVaultDir, vaultDir, { recursive: true });
  await chmodRecursive(vaultDir, "a-w");

  await writeJson(path.join(homeDir, ".grounder", "config.json"), { vaultRoot: vaultDir });

  return { homeDir, vaultDir };
}

/**
 * Fresh repo dir for one search probe run, keyed by {@link sandboxKey}.
 * Kept separate from the shared vault: sharing one `--workspace` cwd across
 * concurrent `cursor-agent`/`claude` processes risks each host's own
 * per-project session-file writes colliding — the same class of problem
 * that forced scratch dirs outside this git repo in the first place.
 */
export async function setupSearchRepoDir(key) {
  const repoDir = path.join(SCRATCH_ROOT, "search-repo", key);
  await rm(repoDir, { recursive: true, force: true });
  await writeJson(path.join(repoDir, ".grounder.json"), { version: 1, projectId: "eval-search" });
  return repoDir;
}

/**
 * Wipes every previous run's per-probe mode-lock scratch dirs. Each is keyed
 * by a hash of (model, probe), so nothing accumulates *within* a sweep, but
 * with no cleanup at all they'd pile up across every sweep ever run on this
 * machine. Call once at the start of a sweep, before any per-probe sandbox
 * is created.
 */
export async function wipeModeLockScratch() {
  await rm(path.join(SCRATCH_ROOT, "mode-lock"), { recursive: true, force: true });
}

/**
 * Sandbox for one mode-lock probe run: a disposable vault (handoff probes
 * write to it for real), seeded with two handoffs so recall probes have
 * something to load — including a `#2` selector. `key` must be unique per
 * (model, probe) run: `writeUniqueMarkdown` never collides on filenames, but
 * listing order is newest-first, so two concurrent runs sharing one vault
 * could still change which file is "#2" for a sibling's selector probe out
 * from under it. A fresh, uniquely-keyed vault every call removes that
 * entirely, rather than just avoiding file corruption.
 */
export async function setupModeLockSandbox(key) {
  const base = path.join(SCRATCH_ROOT, "mode-lock", key);
  const homeDir = path.join(base, "home");
  const repoDir = path.join(base, "repo");
  const vaultDir = path.join(base, "vault");

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
