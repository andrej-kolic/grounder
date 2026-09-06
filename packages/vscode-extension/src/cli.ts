import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Extension bakes in a floor, not a ceiling — bump only when a feature here
 * starts depending on newer CLI behavior (see the plan's Decisions entry on
 * version compatibility). `status --json` shipped in 0.6.0, so that's the floor.
 */
export const MIN_CLI_VERSION = "0.6.0";

/** Honors `GROUNDER_HOME` like the CLI itself does, falling back to the real home dir. */
export function grounderHomeDir(): string {
  return process.env.GROUNDER_HOME || os.homedir();
}

/** `~/.grounder/runtime/dist/cli.js`, honoring `GROUNDER_HOME` like the CLI itself does. */
export function runtimeCliPathFor(homeDir: string): string {
  return path.join(homeDir, ".grounder", "runtime", "dist", "cli.js");
}

/** Absolute path to the materialized CLI entry this extension shells out to. */
export function runtimeCliPath(): string {
  return runtimeCliPathFor(grounderHomeDir());
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

/** Parses `major.minor.patch(-prerelease)?`. Returns `null` on anything else. */
export function parseVersion(raw: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/**
 * Compares two version strings by `major.minor.patch` only: negative if `a` <
 * `b`, positive if `a` > `b`, `0` if equal. Returns `null` if either fails to
 * parse.
 *
 * Deliberately ignores any `-prerelease` suffix rather than applying strict
 * semver precedence (which ranks a prerelease below its own plain release):
 * this is used only for the extension's version-floor check, and a dev build
 * of the floor version (e.g. `0.6.0-dev.2`, this monorepo's own working
 * version) already has whatever landed in `0.6.0` — it isn't "older" than it.
 */
export function compareVersions(a: string, b: string): number | null {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) {
    return null;
  }
  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  return va.patch - vb.patch;
}

/**
 * True when `version` meets `min`. An unparsable version (CLI's own version
 * string format changed, or garbage stdout) is treated as meeting the floor —
 * better to stay silent than to nag on a comparison we can't actually make.
 */
export function meetsMinVersion(version: string, min: string = MIN_CLI_VERSION): boolean {
  const cmp = compareVersions(version, min);
  return cmp === null ? true : cmp >= 0;
}

export type CliResult =
  | { kind: "ok"; stdout: string; stderr: string }
  | { kind: "no-runtime" }
  | { kind: "error"; code: number | null; stderr: string };

/**
 * Invokes the materialized runtime CLI via the extension host's own Node
 * (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`), per the plan's CLI
 * resolution decision — no PATH lookup, no `npx`.
 *
 * Checks the entry file exists before spawning: `process.execPath` (the
 * actual executable) always exists, so a missing `cli.js` never trips
 * `spawn`'s own `ENOENT` — Node would instead start, fail to resolve the
 * module, and exit non-zero with a `MODULE_NOT_FOUND` stack trace on
 * stderr. Checking up front is simpler and more portable than pattern-
 * matching that stack trace.
 */
export async function invokeCli(
  args: readonly string[],
  options: { cwd?: string } = {},
): Promise<CliResult> {
  const cliPath = runtimeCliPath();
  try {
    await access(cliPath);
  } catch {
    return { kind: "no-runtime" };
  }

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: options.cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        resolve({ kind: "no-runtime" });
        return;
      }
      resolve({ kind: "error", code: null, stderr: error.message });
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ kind: "ok", stdout, stderr });
      } else {
        resolve({ kind: "error", code, stderr });
      }
    });
  });
}
