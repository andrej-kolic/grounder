import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
