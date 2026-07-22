import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runHandoffList, runHandoffListWithOptions } from "../../../src/commands/handoff/list.js";
import { runRepoInitWithOptions } from "../../../src/commands/repo/init.js";
import { runVaultInitWithOptions } from "../../../src/commands/vault/init.js";
import { createTempEnv, withGroundedHome } from "../../helpers.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = path.join(pkgRoot, "dist", "cli.js");

function runCli(args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, cwd });
}

async function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
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

describe("commands/handoff/list", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("prints newest handoff paths first", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await writeFile(path.join(logsDir, "2026-06-26-1430.md"), "older", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-1500-newer.md"), "newer", "utf8");

    const { code, out } = await captureStdout(() =>
      runHandoffListWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe(
      [
        path.join(logsDir, "2026-06-26-1500-newer.md"),
        path.join(logsDir, "2026-06-26-1430.md"),
        "",
      ].join("\n"),
    );
  });

  it("prints nothing and exits 0 when logs are empty", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runHandoffListWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe("");
  });

  it("respects --limit", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await writeFile(path.join(logsDir, "2026-06-26-1300.md"), "a", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-1400.md"), "b", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-1500.md"), "c", "utf8");

    const { code, out } = await captureStdout(() =>
      runHandoffListWithOptions({ cwd: env.repo, homeDir: env.home, limit: 1 }),
    );

    expect(code).toBe(0);
    expect(out.trim()).toBe(path.join(logsDir, "2026-06-26-1500.md"));
  });

  it("cli prints paths and honors --limit", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await writeFile(path.join(logsDir, "2026-06-26-1300.md"), "a", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-1500.md"), "b", "utf8");

    const result = runCli(
      ["handoff", "list", "--limit", "1"],
      withGroundedHome(env.home),
      env.repo,
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(path.join(logsDir, "2026-06-26-1500.md"));
  });

  it("returns usage error for invalid --limit", async () => {
    const code = await runHandoffList(["--limit", "abc"]);
    expect(code).toBe(1);
  });

  it("returns usage error for unexpected positionals", async () => {
    const code = await runHandoffList(["remaining", "work"]);
    expect(code).toBe(1);
  });

  it("finds link walking up from a nested cwd", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await writeFile(path.join(logsDir, "2026-06-26-1500.md"), "x", "utf8");

    const nested = path.join(env.repo, "src", "nested");
    await mkdir(nested, { recursive: true });

    const { code, out } = await captureStdout(() =>
      runHandoffListWithOptions({ cwd: nested, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out.trim()).toBe(path.join(logsDir, "2026-06-26-1500.md"));
  });
});
