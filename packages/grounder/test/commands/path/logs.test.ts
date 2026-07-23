import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPathLogsWithOptions } from "../../../src/commands/path/logs.js";
import { runRepoInitWithOptions } from "../../../src/commands/repo/init.js";
import { writeHomeConfig } from "../../../src/connector/home.js";
import { createTempEnv, withGroundedHome } from "../../helpers.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = path.join(pkgRoot, "dist", "cli.js");

function runCli(args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, cwd });
}

describe("commands/path/logs", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("prints resolved logs directory", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      const code = await runPathLogsWithOptions({ cwd: env.repo, homeDir: env.home });
      expect(code).toBe(0);
      expect(chunks.join("").trim()).toBe(path.join(env.vault, "10-Projects", "my-app", "logs"));
    } finally {
      spy.mockRestore();
    }
  });

  it("cli prints resolved logs directory", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    process.env.GROUNDER_HOME = env.home;
    await writeHomeConfig({ vaultRoot: env.vault });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const result = runCli(["path", "logs"], withGroundedHome(env.home), env.repo);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(path.join(env.vault, "10-Projects", "my-app", "logs"));
  });
});
