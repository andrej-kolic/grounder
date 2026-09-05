/**
 * Home-local runtime shared by session hooks *and* skills (originally
 * "Issue 2 — replace `npx grounder` in session hooks"; later extended to cover
 * skill templates too, since they had the identical problem).
 *
 * ## Why
 * Both surfaces used to shell out via `npx grounder …`. `npx <pkg>` (no
 * version specifier) matches against whatever `grounder` version exists in
 * the *current project's own dependencies*; only when the project doesn't
 * declare `grounder` as a dependency does it fall back to fetching
 * `grounder@latest` from the registry. Session hooks and skills both
 * run from arbitrary linked projects, which normally have no reason to depend
 * on `grounder` themselves, so contributors (and anyone ahead of the last
 * publish, or deliberately pinned to an older version) get the wrong binary.
 * Global `pnpm link` / `pnpm add -g` does not change this fallback — see
 * [npm/cli#9244](https://github.com/npm/cli/issues/9244).
 *
 * ## Design
 * On `setup`, materialize this package's `dist/` at
 * `~/.grounder/runtime/dist/` and point both host hook configs *and* the
 * skills copied into `~/.cursor/skills/` / `~/.claude/skills/` at:
 *   `process.execPath` + `~/.grounder/runtime/dist/cli.js` + `<subcommand> …`
 * No global install and no registry fetch at invocation time, for either
 * surface. This mirrors how Corepack (packageManager shims) and Husky/lint-staged
 * (moved off bare `npx` for the same reason, see the strapi/strapi#27006 fix)
 * solve the identical "ambient resolution isn't stable" problem.
 *
 * How it's materialized depends on where grounder is running from:
 * - **Durable source** (monorepo checkout, global install, linked devDependency) →
 *   **symlink** `dist/` straight to the source. `pnpm build` / upgrading the
 *   global install overwrites that same path in place, so hooks and commands
 *   pick up new code immediately — no re-run of `setup` ever needed.
 * - **Ephemeral source** (bare `npx grounder …`, no install — each invocation
 *   resolves to an immutable, version-keyed npx cache dir that can be evicted
 *   or swapped out from under a symlink) → **copy** `dist/`, plus
 *   `package.json` and `templates/` alongside it (see {@link installHookRuntime}'s
 *   doc comment for why those siblings are needed). Re-run
 *   `grounder setup <vault>` after upgrading to refresh; this is an
 *   inherent limitation of using npx with no install for something that must
 *   persist, not something we can engineer around.
 *
 * This mirrors husky/pre-commit hook shims: staying current is an explicit,
 * idempotent step (never silent self-healing inside a hook itself — session
 * hooks must stay fast and side-effect-free), and the step is a no-op unless
 * something has actually changed.
 *
 * ## REVERT
 * To restore the previous `npx grounder …` behavior for hooks and/or commands:
 * 1. Delete this file and its tests (`test/agents/hook-runtime.test.ts`).
 * 2. In `cursor.ts` / `claude.ts`, set `*_PEEK_HOOK_COMMAND` back to
 *    `"npx grounder handoff peek"` and `installCommand` back to a plain
 *    `copyFile` (drop the `{{GROUNDER_CLI}}` template substitution), dropping
 *    calls to {@link installHookRuntime} / {@link peekHookCommand} /
 *    {@link runtimeInvocation} / {@link extractRuntimeNodePath} /
 *    {@link findRuntimeNodePathsInText} /
 *    {@link collectGrounderPeekHookCommands} / {@link hookFileGrounderPeekCommands} /
 *    {@link isGrounderPeekHookCommand} / {@link isHookRuntimeStale}.
 * 3. Remove runtime paths from `expectedHookArtifacts` and docs that mention
 *    `~/.grounder/runtime`, and revert templates' `{{GROUNDER_CLI}}` back to
 *    literal `npx grounder`.
 */

import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHomeDir } from "../connector/home.js";
import { fileExists } from "../util/fs.js";
import type { ArtifactStatus } from "./types.js";

/** Package root (`packages/grounder`) when running from `dist/agents/`. */
const defaultPackageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Marker written next to the materialized runtime for debugging / staleness checks. */
export interface HookRuntimeManifest {
  mode: "symlink" | "copy";
  version: string;
  sourcePackageRoot: string;
  installedAt: string;
}

/** `~/.grounder/runtime` — private materialization of the CLI used only by session hooks. */
export function grounderRuntimeDir(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".grounder", "runtime");
}

/** Absolute path to the materialized CLI entry (`…/runtime/dist/cli.js`). */
export function runtimeCliPath(homeDir?: string): string {
  return path.join(grounderRuntimeDir(homeDir), "dist", "cli.js");
}

export function runtimeManifestPath(homeDir?: string): string {
  return path.join(grounderRuntimeDir(homeDir), "manifest.json");
}

/**
 * POSIX-safe single-quote for embedding paths in hook `command` strings
 * (Cursor/Claude run hooks via a shell on macOS/Linux and Git Bash on Windows).
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Reverse one {@link shellQuote} token starting at `start`.
 * Handles the close/escape/reopen sequence (`'\''`) for embedded quotes.
 */
function parseShellQuoted(input: string, start: number): { value: string; next: number } | null {
  if (input[start] !== "'") {
    return null;
  }
  let i = start + 1;
  let value = "";
  while (i < input.length) {
    if (input[i] === "'") {
      // shellQuote escape: close quote, literal `'`, reopen — characters `'\''`
      if (input[i + 1] === "\\" && input[i + 2] === "'" && input[i + 3] === "'") {
        value += "'";
        i += 4;
        continue;
      }
      return { value, next: i + 1 };
    }
    value += input[i];
    i += 1;
  }
  return null;
}

function isAbsolutePath(p: string): boolean {
  return path.posix.isAbsolute(p) || path.win32.isAbsolute(p);
}

/**
 * Match a home-runtime invocation (`'<abs node>' '<abs …/runtime/dist/cli.js>'`)
 * starting at `start`, returning its baked Node interpreter path.
 *
 * Takes an offset rather than a pre-sliced string so {@link findRuntimeNodePathsInText}
 * can sweep a whole document without allocating a fresh substring at every
 * quote character.
 */
function matchRuntimeInvocationAt(input: string, start: number): string | null {
  const first = parseShellQuoted(input, start);
  if (!first || !isAbsolutePath(first.value)) {
    return null;
  }
  let i = first.next;
  if (input[i] !== " ") {
    return null;
  }
  while (input[i] === " ") {
    i += 1;
  }
  const second = parseShellQuoted(input, i);
  if (!second) {
    return null;
  }
  const cliNormalized = second.value.replace(/\\/g, "/");
  if (!cliNormalized.includes("/.grounder/runtime/dist/cli.js")) {
    return null;
  }
  return first.value;
}

/**
 * Extract the baked Node interpreter path from a home-runtime invocation
 * string (`'<abs node>' '<abs …/runtime/dist/cli.js>' …`).
 *
 * Returns `null` when the string is not that exact shape — including legacy
 * `npx grounder …` entries, which have no absolute interpreter to validate.
 */
export function extractRuntimeNodePath(command: unknown): string | null {
  if (typeof command !== "string") {
    return null;
  }
  return matchRuntimeInvocationAt(command.trim(), 0);
}

/**
 * Find every baked Node interpreter path embedded in free-form text (skill
 * markdown, etc.). Scans for the same `'<abs node>' '<abs …/cli.js>'` shape as
 * {@link extractRuntimeNodePath}, including mid-line / backtick-wrapped uses.
 */
export function findRuntimeNodePathsInText(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "'") {
      continue;
    }
    const nodePath = matchRuntimeInvocationAt(text, i);
    if (nodePath !== null && !seen.has(nodePath)) {
      seen.add(nodePath);
      found.push(nodePath);
    }
  }
  return found;
}

/**
 * Quoted `<node> <runtime cli.js>` prefix, shared by every home-runtime
 * invocation (session hooks and skill templates alike). Append
 * subcommand args to build a full command string.
 */
export function runtimeInvocation(homeDir?: string): string {
  return `${shellQuote(process.execPath)} ${shellQuote(runtimeCliPath(homeDir))}`;
}

/**
 * Build the sessionStart / SessionStart hook command for the home runtime.
 *
 * @param homeDir - Override home (tests / `GROUNDER_HOME`)
 * @param extraArgs - Extra CLI args after `handoff peek` (e.g. `--json` for Cursor)
 */
export function peekHookCommand(homeDir?: string, extraArgs: readonly string[] = []): string {
  return [runtimeInvocation(homeDir), "handoff", "peek", ...extraArgs].join(" ");
}

/**
 * True when `command` is Grounder's peek hook — current home-runtime form or
 * legacy `npx grounder handoff peek` (with optional trailing flags).
 * Used so upgrades replace the old entry instead of appending a duplicate.
 */
export function isGrounderPeekHookCommand(command: unknown): boolean {
  if (typeof command !== "string") {
    return false;
  }
  const trimmed = command.trim();
  if (/^npx\s+grounder\s+handoff\s+peek(?:\s|$)/.test(trimmed)) {
    return true;
  }
  // Normalize separators so Windows absolute paths still match.
  const normalized = trimmed.replace(/\\/g, "/");
  return (
    normalized.includes("/.grounder/runtime/dist/cli.js") && /\bhandoff\s+peek\b/.test(normalized)
  );
}

/** Collect Grounder peek hook `command` strings nested anywhere in parsed JSON. */
export function collectGrounderPeekHookCommands(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) {
        walk(item);
      }
      return;
    }
    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      if (typeof obj.command === "string" && isGrounderPeekHookCommand(obj.command)) {
        out.push(obj.command);
      }
      for (const child of Object.values(obj)) {
        walk(child);
      }
    }
  };
  walk(value);
  return out;
}

/** True when any nested `command` field in parsed JSON is Grounder's peek hook. */
export function jsonContainsGrounderPeekCommand(value: unknown): boolean {
  return collectGrounderPeekHookCommands(value).length > 0;
}

/** Grounder peek hook command strings in a hooks/settings JSON file (empty if absent/unreadable). */
export async function hookFileGrounderPeekCommands(filePath: string): Promise<string[]> {
  try {
    if (!(await fileExists(filePath))) {
      return [];
    }
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return collectGrounderPeekHookCommands(parsed);
  } catch {
    return [];
  }
}

/** True when a hooks/settings JSON file contains Grounder's peek hook entry. */
export async function hookFileHasGrounderEntry(filePath: string): Promise<boolean> {
  return (await hookFileGrounderPeekCommands(filePath)).length > 0;
}

/**
 * Best-effort: is `root` inside a throwaway cache (npx / pnpm dlx), where
 * content can be evicted or swapped for a *different* version at any time?
 * Those sources can't be symlinked durably — copy instead.
 *
 * The tmpdir-prefix check realpaths both sides (with a plain-resolve
 * fallback if either doesn't exist) before comparing — the same fix as
 * {@link isSelfReferential}, for the same reason: Node's module loader
 * realpaths the entry script when resolving `import.meta.url`, so a
 * `packageRoot` derived from that can come out realpath'd while
 * `os.tmpdir()`'s raw string doesn't (e.g. macOS's `/var` -> `/private/var`,
 * which a package copied under a temp-dir-based test fixture sits behind
 * but a real `npx`/`pnpm dlx` cache path typically doesn't). The regex
 * branch below has no such dependency and was never affected.
 */
async function isEphemeralSource(root: string): Promise<boolean> {
  const resolvedRoot = await realpath(root).catch(() => path.resolve(root));
  const resolvedTmp = await realpath(os.tmpdir()).catch(() => path.resolve(os.tmpdir()));
  const normalized = `${resolvedRoot.replace(/\\/g, "/")}/`;
  const tmp = `${resolvedTmp.replace(/\\/g, "/")}/`;
  if (normalized.startsWith(tmp)) {
    return true;
  }
  return /\/(_npx|\.npm\/_npx|\.pnpm-dlx-|pnpm-dlx-)[^/]*\//.test(normalized);
}

/**
 * True when `packageRoot` resolves to `~/.grounder/runtime` itself — i.e.
 * this invocation is running *through* the materialized runtime's own
 * `dist/cli.js` (`defaultPackageRoot` computed from that file's own
 * `import.meta.url`) rather than through the real `grounder` / `npx
 * grounder` entrypoints the docs point users at. That invocation has no way
 * to know the real upstream source the runtime was originally materialized
 * from, so comparing the runtime against itself is nonsensical: a copied
 * (non-symlink) `dist/` would otherwise permanently read as "should be a
 * symlink, but isn't" (since `isEphemeralSource(~/.grounder/runtime)` is
 * false for a real home dir), and `installHookRuntime` would attempt to
 * symlink `dist/` to its own about-to-be-renamed-aside path — a circular,
 * corrupting symlink.
 *
 * Realpath'd on both sides, with a plain-resolve fallback if either doesn't
 * exist yet — a naive string compare misses this the same way the original
 * bug (`isEphemeralSource`'s `os.tmpdir()` check) did: Node's module loader
 * realpaths the entry script when resolving `import.meta.url`, so
 * `defaultPackageRoot` comes out realpath'd while `grounderRuntimeDir()`
 * (built from the raw `GROUNDER_HOME` string) doesn't — e.g. macOS's
 * `/var` -> `/private/var`, which a test `$HOME` under `os.tmpdir()` sits
 * behind but a real user's `~` typically doesn't.
 */
async function isSelfReferential(packageRoot: string, homeDir?: string): Promise<boolean> {
  const runtimeDir = grounderRuntimeDir(homeDir);
  const [resolvedRoot, resolvedRuntime] = await Promise.all([
    realpath(packageRoot).catch(() => path.resolve(packageRoot)),
    realpath(runtimeDir).catch(() => path.resolve(runtimeDir)),
  ]);
  return resolvedRoot === resolvedRuntime;
}

async function readPackageVersion(packageRoot: string): Promise<string> {
  try {
    const raw = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof raw.version === "string" ? raw.version : "unknown";
  } catch {
    return "unknown";
  }
}

async function readRuntimeManifest(homeDir?: string): Promise<HookRuntimeManifest | null> {
  try {
    const raw = JSON.parse(await readFile(runtimeManifestPath(homeDir), "utf8")) as Partial<
      Record<keyof HookRuntimeManifest, unknown>
    >;
    if (typeof raw.version !== "string" || (raw.mode !== "symlink" && raw.mode !== "copy")) {
      return null;
    }
    return {
      mode: raw.mode,
      version: raw.version,
      sourcePackageRoot: typeof raw.sourcePackageRoot === "string" ? raw.sourcePackageRoot : "",
      installedAt: typeof raw.installedAt === "string" ? raw.installedAt : "",
    };
  } catch {
    return null;
  }
}

/** Realpath of `destDist` if it's currently a directory symlink, else `null`. */
async function currentSymlinkTarget(destDist: string): Promise<string | null> {
  try {
    const info = await lstat(destDist);
    if (!info.isSymbolicLink()) {
      return null;
    }
    return await realpath(destDist);
  } catch {
    return null;
  }
}

/**
 * True when the materialized runtime is missing or out of date for the given
 * source package:
 * - **Self-referential** (`packageRoot` is `~/.grounder/runtime` itself —
 *   see {@link isSelfReferential}): never stale. There is no real source to
 *   compare against from inside this invocation, so the only sound answer is
 *   "leave it alone."
 * - **Symlink mode** (durable source): stale iff `dist/` isn't currently a
 *   symlink resolving to this source's `dist/` (cheap `realpath` compare — no
 *   staleness window, since a matching symlink is *always* current).
 * - **Copy mode** (ephemeral `npx` source): stale iff the manifest is
 *   missing/unreadable, its recorded version differs from this source's, or
 *   `package.json` / `templates/` (when the source has one) are missing
 *   alongside `dist/` — a same-version repair case a version-only check
 *   would otherwise skip forever (e.g. a runtime materialized before these
 *   siblings were added, or one left mid-way by a partial install).
 *
 * @param packageRoot - Source package root to compare against (defaults to the
 *   currently running package — override only in tests)
 */
export async function isHookRuntimeStale(
  homeDir?: string,
  packageRoot: string = defaultPackageRoot,
): Promise<boolean> {
  if (!(await fileExists(runtimeCliPath(homeDir)))) {
    return true;
  }

  if (await isSelfReferential(packageRoot, homeDir)) {
    return false;
  }

  const runtimeDir = grounderRuntimeDir(homeDir);
  const destDist = path.join(runtimeDir, "dist");
  if (await isEphemeralSource(packageRoot)) {
    const manifest = await readRuntimeManifest(homeDir);
    if (manifest?.mode !== "copy") {
      return true;
    }
    if (manifest.version !== (await readPackageVersion(packageRoot))) {
      return true;
    }
    if (!(await fileExists(path.join(runtimeDir, "package.json")))) {
      return true;
    }
    if (
      (await fileExists(path.join(packageRoot, "templates"))) &&
      !(await fileExists(path.join(runtimeDir, "templates")))
    ) {
      return true;
    }
    return false;
  }

  const sourceDistDir = path.join(packageRoot, "dist");
  const resolvedSource = await realpath(sourceDistDir).catch(() => path.resolve(sourceDistDir));
  const target = await currentSymlinkTarget(destDist);
  return target !== resolvedSource;
}

/**
 * Materialization mode this source would use — symlink (durable) or copy
 * (ephemeral `npx` cache) — without writing anything (read-only `realpath`
 * checks only). Lets callers label a skipped/dry-run install the same way
 * {@link installHookRuntime} would.
 */
export async function runtimeMode(
  packageRoot: string = defaultPackageRoot,
): Promise<"symlink" | "copy"> {
  return (await isEphemeralSource(packageRoot)) ? "copy" : "symlink";
}

/**
 * Materialize every artifact via `populate(stagingPath)` first — a
 * populate/symlink/cp failure on any one of them leaves every `dest`
 * untouched, since none have been promoted yet. Only once all of them are
 * staged does promotion (backup-aside + rename-in) run for each in turn.
 *
 * If a promote fails partway through, every artifact already promoted in
 * this call is rolled back (its backup renamed back over `dest`) before
 * rethrowing — so a failure on, say, `package.json` after `dist/` has
 * already promoted doesn't leave a new `dist/` sitting next to an old
 * `package.json`. This isn't a true single filesystem transaction (POSIX
 * has no atomic rename across independent paths), but it narrows the
 * mixed-state window down to the renames themselves rather than leaving one
 * as a visible end state after this function returns (successfully or not).
 *
 * A restore rename (`backup` back over `dest`) can itself fail — e.g. the
 * same fault that broke the promote also blocks the rename back. When that
 * happens `dest` is left in whatever state the failed renames put it in, but
 * `backup` is deliberately *not* deleted by the cleanup below: it's the only
 * remaining copy of what was there before this call, so a double failure
 * degrades to "manual recovery from `<dest>.bak`" rather than silent data
 * loss.
 *
 * `populate` decides how each artifact's staging gets filled (symlink vs.
 * plain copy) — everything else (staging, backup, promote, rollback,
 * cleanup) is identical for every artifact {@link installHookRuntime}
 * materializes (`dist/`, and in copy mode, `package.json` / `templates/`).
 */
export async function installArtifacts(
  artifacts: Array<{ dest: string; populate: (staging: string) => Promise<void> }>,
): Promise<void> {
  const staged: Array<{ dest: string; staging: string; backup: string }> = [];
  try {
    for (const { dest, populate } of artifacts) {
      const staging = `${dest}.staging`;
      const backup = `${dest}.bak`;
      await rm(staging, { recursive: true, force: true });
      await rm(backup, { recursive: true, force: true });
      await populate(staging);
      staged.push({ dest, staging, backup });
    }
  } catch (error: unknown) {
    for (const { staging } of staged) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }

  // Backups a restore attempt below failed to rename back over `dest` —
  // `dest` is not confirmed to hold valid content, so `backup` is the only
  // surviving copy of what was there before this call and must not be
  // deleted by the cleanup in `finally`.
  const unsafeToDeleteBackup = new Set<string>();

  /** Best-effort `rename(backup, dest)`; marks `backup` unsafe to delete on failure. */
  async function restore(backup: string, dest: string): Promise<void> {
    try {
      await rename(backup, dest);
    } catch {
      unsafeToDeleteBackup.add(backup);
    }
  }

  const promoted: Array<{ dest: string; backup: string }> = [];
  try {
    for (const { dest, staging, backup } of staged) {
      // Move the live dest aside (if any), then promote staging. On promote
      // failure, restore this artifact's own backup so it keeps working.
      try {
        await rename(dest, backup);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
      try {
        await rename(staging, dest);
      } catch (error: unknown) {
        // Rethrow the promote failure below regardless of restore outcome.
        await restore(backup, dest);
        throw error;
      }
      promoted.push({ dest, backup });
    }
  } catch (error: unknown) {
    // Roll back every artifact promoted before this one failed.
    for (const { dest, backup } of promoted.reverse()) {
      await rm(dest, { recursive: true, force: true }).catch(() => undefined);
      await restore(backup, dest);
    }
    throw error;
  } finally {
    for (const { staging, backup } of staged) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      if (!unsafeToDeleteBackup.has(backup)) {
        await rm(backup, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
}

/**
 * Materialize this package's `dist/` at `~/.grounder/runtime/dist/` — symlinked
 * when the source is durable, copied when it's an ephemeral `npx` cache — and
 * write a manifest recording how.
 *
 * Copy mode also copies `package.json` and `templates/` alongside `dist/`:
 * `src/index.ts` reads `VERSION` from `<pkgRoot>/package.json` eagerly at
 * import (every invocation), and `home-skills.ts` reads `<pkgRoot>/templates`
 * on demand (`desiredArtifacts()` — real installs, and the drift check
 * `status`/`doctor`/`peek` run). Neither exists under a copied `dist/`'s
 * parent otherwise, so the materialized runtime crashed at import for every
 * copy-mode (bare `npx grounder setup`) user. Symlink mode needs neither —
 * Node resolves `import.meta.url` through `dist/`'s own symlink back to the
 * real package root, package.json and templates included — and actively
 * removes them if a previous copy-mode install left them behind, so
 * `~/.grounder/runtime` never ends up with stale copy-mode siblings next to
 * a symlinked `dist/`.
 *
 * Callers should gate on {@link isHookRuntimeStale} (or `force`) before calling —
 * this always replaces whatever is currently at the destination. All
 * artifacts (`dist/`, and in copy mode, `package.json` / `templates/`) are
 * staged and promoted together via {@link installArtifacts}, which rolls
 * back any artifact already promoted if a later one fails to promote.
 * Refuses outright (see {@link isSelfReferential}) rather than attempting a
 * self-symlink that would corrupt the runtime with an `ELOOP`-inducing link
 * to itself.
 *
 * @param options.packageRoot - Source package root to materialize (defaults to
 *   the currently running package — override only in tests)
 */
export async function installHookRuntime(options: {
  homeDir?: string;
  packageRoot?: string;
}): Promise<{ cliPath: string; status: ArtifactStatus; mode: "symlink" | "copy" }> {
  const packageRoot = options.packageRoot ?? defaultPackageRoot;
  if (await isSelfReferential(packageRoot, options.homeDir)) {
    throw new Error(
      `Refusing to materialize ~/.grounder/runtime from itself (${grounderRuntimeDir(options.homeDir)}). ` +
        "This usually means a command ran directly against " +
        "~/.grounder/runtime/dist/cli.js instead of the `grounder` (or `npx grounder`) entrypoint.",
    );
  }
  const sourceDistDir = path.join(packageRoot, "dist");
  const runtimeDir = grounderRuntimeDir(options.homeDir);
  const destDist = path.join(runtimeDir, "dist");
  const cliPath = runtimeCliPath(options.homeDir);
  const existed = await fileExists(cliPath);

  if (!(await fileExists(path.join(sourceDistDir, "cli.js")))) {
    throw new Error(
      `Grounder dist missing at ${sourceDistDir}. Run \`pnpm build\` (or install a published package) before setup.`,
    );
  }

  await mkdir(runtimeDir, { recursive: true });

  const mode: "symlink" | "copy" = await runtimeMode(packageRoot);
  const artifacts: Array<{ dest: string; populate: (staging: string) => Promise<void> }> = [
    {
      dest: destDist,
      populate: async (staging) => {
        if (mode === "symlink") {
          const resolvedSource = await realpath(sourceDistDir).catch(() =>
            path.resolve(sourceDistDir),
          );
          await symlink(resolvedSource, staging, process.platform === "win32" ? "junction" : "dir");
        } else {
          await cp(sourceDistDir, staging, { recursive: true, force: true });
        }
      },
    },
  ];

  if (mode === "copy") {
    artifacts.push({
      dest: path.join(runtimeDir, "package.json"),
      populate: (staging) => cp(path.join(packageRoot, "package.json"), staging),
    });
    const templatesSource = path.join(packageRoot, "templates");
    if (await fileExists(templatesSource)) {
      artifacts.push({
        dest: path.join(runtimeDir, "templates"),
        populate: (staging) => cp(templatesSource, staging, { recursive: true, force: true }),
      });
    }
  }

  await installArtifacts(artifacts);

  if (mode === "symlink") {
    // A previous copy-mode install may have left package.json/templates/
    // behind — harmless (symlinked dist/ resolves import.meta.url through to
    // the real package root regardless), but stale siblings sitting next to
    // a symlinked dist/ would confuse anyone inspecting ~/.grounder/runtime.
    await rm(path.join(runtimeDir, "package.json"), { force: true });
    await rm(path.join(runtimeDir, "templates"), { recursive: true, force: true });
  }

  const manifest: HookRuntimeManifest = {
    mode,
    version: await readPackageVersion(packageRoot),
    sourcePackageRoot: packageRoot,
    installedAt: new Date().toISOString(),
  };
  await writeFile(runtimeManifestPath(options.homeDir), `${JSON.stringify(manifest, null, 2)}\n`);

  return { cliPath, status: existed ? "overwritten" : "created", mode };
}
