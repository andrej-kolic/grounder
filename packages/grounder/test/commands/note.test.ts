import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runNoteWithOptions } from "../../src/commands/note.js";
import { runRepoInitWithOptions } from "../../src/commands/repo/init.js";
import { runVaultInitWithOptions } from "../../src/commands/vault/init.js";
import { writeHomeConfig } from "../../src/connector/home.js";
import { createTempEnv, withGroundedHome } from "../helpers.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(pkgRoot, "dist", "cli.js");

function runCli(args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, cwd });
}

describe("commands/note", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("writes note end-to-end", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const fixedTime = new Date("2026-06-26T14:30:00");
    const code = await runNoteWithOptions({
      cwd: env.repo,
      text: "Investigate auth middleware",
      homeDir: env.home,
      now: fixedTime,
    });

    expect(code).toBe(0);
    const notePath = path.join(
      env.vault,
      "10-Projects",
      "my-app",
      "notes",
      "2026-06-26-1430-investigate-auth-mid.md",
    );
    expect(await readFile(notePath, "utf8")).toBe("Investigate auth middleware");
  });

  it("cli prints written path", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const result = runCli(["note", "hello world"], withGroundedHome(env.home), env.repo);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Wrote ");
    expect(result.stdout).toMatch(/\d{4}-\d{2}-\d{2}-\d{4}-hello-world\.md/);
  });

  it("path notes prints resolved directory", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    process.env.GROUNDER_HOME = env.home;
    await writeHomeConfig({ vaultRoot: env.vault });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const result = runCli(["path", "notes"], withGroundedHome(env.home), env.repo);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(
      path.join(env.vault, "10-Projects", "my-app", "notes"),
    );
  });
});
