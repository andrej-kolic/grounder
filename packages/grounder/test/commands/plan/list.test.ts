import { spawnSync } from "node:child_process";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runPlanList, runPlanListWithOptions } from "../../../src/commands/plan/list.js";
import { runRepoInitWithOptions } from "../../../src/commands/repo/init.js";
import { runVaultInitWithOptions } from "../../../src/commands/vault/init.js";
import { captureStdout, createTempEnv, withGroundedHome } from "../../helpers.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = path.join(pkgRoot, "dist", "cli.js");

function runCli(args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, cwd });
}

async function touch(filePath: string, when: Date): Promise<void> {
  await utimes(filePath, when, when);
}

describe("commands/plan/list", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("prints newest plans first as numbered title + path blocks", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const plansDir = path.join(env.vault, "10-Projects", "my-app", "plans");
    const older = path.join(plansDir, "older.md");
    const newer = path.join(plansDir, "document 1.md");
    await writeFile(older, "older", "utf8");
    await writeFile(newer, "newer", "utf8");
    await touch(older, new Date("2026-06-26T14:00:00.000Z"));
    await touch(newer, new Date("2026-06-26T15:00:00.000Z"));

    const { code, out } = await captureStdout(() =>
      runPlanListWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe(`1. document 1\n  ${newer}\n\n2. older\n  ${older}\n`);
  });

  it("prints nothing and exits 0 when plans are empty", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runPlanListWithOptions({ cwd: env.repo, homeDir: env.home }),
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

    const plansDir = path.join(env.vault, "10-Projects", "my-app", "plans");
    const a = path.join(plansDir, "a.md");
    const b = path.join(plansDir, "b.md");
    const c = path.join(plansDir, "c.md");
    await writeFile(a, "a", "utf8");
    await writeFile(b, "b", "utf8");
    await writeFile(c, "c", "utf8");
    await touch(a, new Date("2026-06-26T13:00:00.000Z"));
    await touch(b, new Date("2026-06-26T14:00:00.000Z"));
    await touch(c, new Date("2026-06-26T15:00:00.000Z"));

    const { code, out } = await captureStdout(() =>
      runPlanListWithOptions({ cwd: env.repo, homeDir: env.home, limit: 1 }),
    );

    expect(code).toBe(0);
    expect(out).toBe(`1. c\n  ${c}\n`);
  });

  it("cli prints numbered title + path blocks and honors --limit", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const plansDir = path.join(env.vault, "10-Projects", "my-app", "plans");
    const older = path.join(plansDir, "older.md");
    const newer = path.join(plansDir, "newer.md");
    await writeFile(older, "a", "utf8");
    await writeFile(newer, "b", "utf8");
    await touch(older, new Date("2026-06-26T13:00:00.000Z"));
    await touch(newer, new Date("2026-06-26T15:00:00.000Z"));

    const result = runCli(["plan", "list", "--limit", "1"], withGroundedHome(env.home), env.repo);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`1. newer\n  ${newer}\n`);
  });

  it("returns usage error for invalid --limit", async () => {
    expect(await runPlanList(["--limit", "abc"])).toBe(1);
    expect(await runPlanList(["--limit", "0"])).toBe(1);
    expect(await runPlanList(["--limit"])).toBe(1);
    expect(await runPlanList(["--limit", "-1"])).toBe(1);
    expect(await runPlanList(["--unknown"])).toBe(1);
  });

  it("returns usage error for unexpected positionals", async () => {
    const code = await runPlanList(["remaining", "work"]);
    expect(code).toBe(1);
  });

  it("finds link walking up from a nested cwd", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const plansDir = path.join(env.vault, "10-Projects", "my-app", "plans");
    const planPath = path.join(plansDir, "phase-1.md");
    await writeFile(planPath, "x", "utf8");

    const nested = path.join(env.repo, "src", "nested");
    await mkdir(nested, { recursive: true });

    const { code, out } = await captureStdout(() =>
      runPlanListWithOptions({ cwd: nested, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe(`1. phase-1\n  ${planPath}\n`);
  });
});
