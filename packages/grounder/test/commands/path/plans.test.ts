import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runPathPlansWithOptions } from "../../../src/commands/path/plans.js";
import { runRepoInitWithOptions } from "../../../src/commands/repo/init.js";
import { writeHomeConfig } from "../../../src/connector/home.js";
import { captureStdout, createTempEnv, withGroundedHome } from "../../helpers.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = path.join(pkgRoot, "dist", "cli.js");

function runCli(args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, cwd });
}

describe("commands/path/plans", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("prints resolved plans directory", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runPathPlansWithOptions({ cwd: env.repo, homeDir: env.home }),
    );
    expect(code).toBe(0);
    expect(out.trim()).toBe(path.join(env.vault, "10-Projects", "my-app", "plans"));
  });

  it("cli prints resolved plans directory", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    process.env.GROUNDER_HOME = env.home;
    await writeHomeConfig({ vaultRoot: env.vault });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const result = runCli(["path", "plans"], withGroundedHome(env.home), env.repo);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(path.join(env.vault, "10-Projects", "my-app", "plans"));
  });
});
