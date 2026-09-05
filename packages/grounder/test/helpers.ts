import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

export interface TempEnv {
  home: string;
  vault: string;
  repo: string;
  cleanup: () => Promise<void>;
}

export async function createTempEnv(options?: {
  initGit?: boolean;
  packageName?: string;
}): Promise<TempEnv> {
  const base = await mkdtemp(path.join(os.tmpdir(), "grounder-test-"));
  const home = path.join(base, "home");
  const vault = path.join(base, "vault");
  const repo = path.join(base, "repo");

  await import("node:fs/promises").then(({ mkdir, writeFile }) =>
    Promise.all([
      mkdir(home, { recursive: true }),
      mkdir(vault, { recursive: true }),
      mkdir(repo, { recursive: true }),
    ]).then(async () => {
      if (options?.packageName) {
        await writeFile(
          path.join(repo, "package.json"),
          `${JSON.stringify({ name: options.packageName }, null, 2)}\n`,
        );
      }
    }),
  );

  if (options?.initGit !== false) {
    execSync("git init", { cwd: repo, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: repo, stdio: "ignore" });
    execSync('git config user.name "Test User"', { cwd: repo, stdio: "ignore" });
  }

  return {
    home,
    vault,
    repo,
    cleanup: async () => {
      await rm(base, { recursive: true, force: true });
    },
  };
}

export function withGroundedHome(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GROUNDER_HOME: home,
    HOME: home,
  };
}

/**
 * True when a `render-artifact-table.ts` table in `out` has a row with this
 * exact status and path. Pass `target` to also pin the TARGET column (e.g.
 * `"cursor hook"` vs. `"cursor"`) rather than matching any target.
 */
export function hasRow(
  out: string,
  status: string,
  artifactPath: string,
  target?: string,
): boolean {
  return out.split("\n").some((line) => {
    const trimmed = line.trimEnd();
    if (!trimmed.endsWith(artifactPath)) {
      return false;
    }
    const rest = trimmed.slice(0, trimmed.length - artifactPath.length).trim();
    const words = rest.split(/\s+/);
    if (words[0] !== status) {
      return false;
    }
    return target === undefined || words.slice(1).join(" ") === target;
  });
}

export async function captureStdout(
  fn: () => Promise<number>,
): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    const code = await fn();
    return { code, out: chunks.join("") };
  } finally {
    spy.mockRestore();
  }
}

/** Like `captureStdout`, for sync void-returning renderers (no exit code to report). */
export function captureSyncStdout(fn: () => void): string {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    fn();
    return chunks.join("");
  } finally {
    spy.mockRestore();
  }
}
