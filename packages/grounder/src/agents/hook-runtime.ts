/**
 * Home-local runtime shared by session hooks *and* slash commands (originally
 * "Issue 2 — replace `npx grounder` in session hooks"; later extended to cover
 * slash-command templates too, since they had the identical problem).
 *
 * ## Why
 * Both surfaces used to shell out via `npx grounder …`. `npx <pkg>` (no
 * version specifier) matches against whatever `grounder` version exists in
 * the *current project's own dependencies*; only when the project doesn't
 * declare `grounder` as a dependency does it fall back to fetching
 * `grounder@latest` from the registry. Session hooks and slash commands both
 * run from arbitrary linked projects, which normally have no reason to depend
 * on `grounder` themselves, so contributors (and anyone ahead of the last
 * publish, or deliberately pinned to an older version) get the wrong binary.
 * Global `pnpm link` / `pnpm add -g` does not change this fallback — see
 * [npm/cli#9244](https://github.com/npm/cli/issues/9244).
 *
 * ## Design
 * On `vault init`, materialize this package's `dist/` at
 * `~/.grounder/runtime/dist/` and point both host hook configs *and* the
 * commands copied into `~/.cursor/commands/` / `~/.claude/commands/` at:
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
 *   pick up new code immediately — no re-run of `vault init` ever needed.
 * - **Ephemeral source** (bare `npx grounder …`, no install — each invocation
 *   resolves to an immutable, version-keyed npx cache dir that can be evicted
 *   or swapped out from under a symlink) → **copy** `dist/`. Re-run
 *   `grounder vault init <vault>` after upgrading to refresh; this is an
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
  const trimmed = command.trim();
  const first = parseShellQuoted(trimmed, 0);
  if (!first || !isAbsolutePath(first.value)) {
    return null;
  }
  let i = first.next;
  if (trimmed[i] !== " ") {
    return null;
  }
  while (trimmed[i] === " ") {
    i += 1;
  }
  const second = parseShellQuoted(trimmed, i);
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
 * Quoted `<node> <runtime cli.js>` prefix, shared by every home-runtime
 * invocation (session hooks and slash-command templates alike). Append
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

/** True when any nested `command` field in parsed JSON is Grounder's peek hook. */
export function jsonContainsGrounderPeekCommand(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(jsonContainsGrounderPeekCommand);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (isGrounderPeekHookCommand(obj.command)) {
      return true;
    }
    return Object.values(obj).some(jsonContainsGrounderPeekCommand);
  }
  return false;
}

/** True when a hooks/settings JSON file contains Grounder's peek hook entry. */
export async function hookFileHasGrounderEntry(filePath: string): Promise<boolean> {
  try {
    if (!(await fileExists(filePath))) {
      return false;
    }
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return jsonContainsGrounderPeekCommand(parsed);
  } catch {
    return false;
  }
}

/**
 * Best-effort: is `root` inside a throwaway cache (npx / pnpm dlx), where
 * content can be evicted or swapped for a *different* version at any time?
 * Those sources can't be symlinked durably — copy instead.
 */
function isEphemeralSource(root: string): boolean {
  const normalized = `${path.resolve(root).replace(/\\/g, "/")}/`;
  const tmp = `${path.resolve(os.tmpdir()).replace(/\\/g, "/")}/`;
  if (normalized.startsWith(tmp)) {
    return true;
  }
  return /\/(_npx|\.npm\/_npx|\.pnpm-dlx-|pnpm-dlx-)[^/]*\//.test(normalized);
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
 * - **Symlink mode** (durable source): stale iff `dist/` isn't currently a
 *   symlink resolving to this source's `dist/` (cheap `realpath` compare — no
 *   staleness window, since a matching symlink is *always* current).
 * - **Copy mode** (ephemeral `npx` source): stale iff the manifest is
 *   missing/unreadable or its recorded version differs from this source's.
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

  const destDist = path.join(grounderRuntimeDir(homeDir), "dist");
  if (isEphemeralSource(packageRoot)) {
    const manifest = await readRuntimeManifest(homeDir);
    if (manifest?.mode !== "copy") {
      return true;
    }
    return manifest.version !== (await readPackageVersion(packageRoot));
  }

  const sourceDistDir = path.join(packageRoot, "dist");
  const resolvedSource = await realpath(sourceDistDir).catch(() => path.resolve(sourceDistDir));
  const target = await currentSymlinkTarget(destDist);
  return target !== resolvedSource;
}

/**
 * Materialize this package's `dist/` at `~/.grounder/runtime/dist/` — symlinked
 * when the source is durable, copied when it's an ephemeral `npx` cache — and
 * write a manifest recording how.
 *
 * Callers should gate on {@link isHookRuntimeStale} (or `force`) before calling —
 * this always replaces whatever is currently at the destination, staging the
 * new materialization first so a failed symlink/cp leaves the live runtime intact.
 *
 * @param options.packageRoot - Source package root to materialize (defaults to
 *   the currently running package — override only in tests)
 */
export async function installHookRuntime(options: {
  homeDir?: string;
  packageRoot?: string;
}): Promise<{ cliPath: string; status: ArtifactStatus; mode: "symlink" | "copy" }> {
  const packageRoot = options.packageRoot ?? defaultPackageRoot;
  const sourceDistDir = path.join(packageRoot, "dist");
  const runtimeDir = grounderRuntimeDir(options.homeDir);
  const destDist = path.join(runtimeDir, "dist");
  const cliPath = runtimeCliPath(options.homeDir);
  const existed = await fileExists(cliPath);

  if (!(await fileExists(path.join(sourceDistDir, "cli.js")))) {
    throw new Error(
      `Grounder dist missing at ${sourceDistDir}. Run \`pnpm build\` (or install a published package) before vault init.`,
    );
  }

  await mkdir(runtimeDir, { recursive: true });

  // Stage into a sibling path first, then swap. If symlink/cp fails, the live
  // `dist/` (and any hooks pointing at it) stay intact.
  const stagingDist = `${destDist}.staging`;
  const backupDist = `${destDist}.bak`;
  await rm(stagingDist, { recursive: true, force: true });
  await rm(backupDist, { recursive: true, force: true });

  const mode: "symlink" | "copy" = isEphemeralSource(packageRoot) ? "copy" : "symlink";
  try {
    if (mode === "symlink") {
      const resolvedSource = await realpath(sourceDistDir).catch(() => path.resolve(sourceDistDir));
      await symlink(resolvedSource, stagingDist, process.platform === "win32" ? "junction" : "dir");
    } else {
      await cp(sourceDistDir, stagingDist, { recursive: true, force: true });
    }

    // Move the live dest aside (if any), then promote staging. On promote
    // failure, restore the backup so hooks keep a working cli.js.
    try {
      await rename(destDist, backupDist);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    try {
      await rename(stagingDist, destDist);
    } catch (error: unknown) {
      try {
        await rename(backupDist, destDist);
      } catch {
        // Best-effort restore; rethrow the promote failure below.
      }
      throw error;
    }
    await rm(backupDist, { recursive: true, force: true });
  } catch (error: unknown) {
    await rm(stagingDist, { recursive: true, force: true }).catch(() => undefined);
    throw error;
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
