import { spawnSync } from "node:child_process";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runLinkWithOptions } from "../../src/commands/link.js";
import { runOverview, runOverviewWithOptions } from "../../src/commands/overview.js";
import { runSetupWithOptions } from "../../src/commands/setup.js";
import { captureStdout, createTempEnv, withGroundedHome } from "../helpers.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(pkgRoot, "dist", "cli.js");

function runCli(args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, cwd });
}

async function touch(filePath: string, when: Date): Promise<void> {
  await utimes(filePath, when, when);
}

describe("commands/overview", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("prints No … for every bucket when the vault is empty", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runOverviewWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe("Notes\nNo notes.\n\nHandoffs\nNo handoffs.\n\nPlans\nNo plans.\n");
  });

  it("prints per-bucket counts and newest-first titles under the default limit", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const notesDir = path.join(env.vault, "10-Projects", "my-app", "notes");
    const notePath = path.join(notesDir, "phase-1.md");
    await writeFile(notePath, "x", "utf8");

    const { code, out } = await captureStdout(() =>
      runOverviewWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe(
      `Notes\nAll 1 note:\n\n1. phase-1  \n  ${notePath}\n\n` +
        "Handoffs\nNo handoffs.\n\nPlans\nNo plans.\n",
    );
  });

  it("caps recent titles per bucket at --limit and signals possible truncation", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const notesDir = path.join(env.vault, "10-Projects", "my-app", "notes");
    const older = path.join(notesDir, "older.md");
    const newer = path.join(notesDir, "newer.md");
    await writeFile(older, "a", "utf8");
    await writeFile(newer, "b", "utf8");
    await touch(older, new Date("2026-06-26T13:00:00.000Z"));
    await touch(newer, new Date("2026-06-26T15:00:00.000Z"));

    const { code, out } = await captureStdout(() =>
      runOverviewWithOptions({ cwd: env.repo, homeDir: env.home, limit: 1 }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Most recent 1 note (there may be more):\n\n1. newer  \n");
  });

  it("prints markdown link title lines with --markdown", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const notesDir = path.join(env.vault, "10-Projects", "my-app", "notes");
    const notePath = path.join(notesDir, "phase-1.md");
    await writeFile(notePath, "x", "utf8");

    const { code, out } = await captureStdout(() =>
      runOverviewWithOptions({ cwd: env.repo, homeDir: env.home, markdown: true }),
    );

    expect(code).toBe(0);
    expect(out).toContain(`1. [phase-1.md](${pathToFileURL(notePath).href})  \n  ${notePath}\n`);
  });

  it("prints structured JSON with --json, covering all three buckets", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const notesDir = path.join(env.vault, "10-Projects", "my-app", "notes");
    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    const plansDir = path.join(env.vault, "10-Projects", "my-app", "plans");
    const notePath = path.join(notesDir, "phase-1.md");
    const handoffPath = path.join(logsDir, "2026-06-26-120000-session.md");
    const planPath = path.join(plansDir, "auth-rewrite.md");
    await writeFile(notePath, "x", "utf8");
    await writeFile(handoffPath, "y", "utf8");
    await writeFile(planPath, "z", "utf8");

    const { code, out } = await captureStdout(() =>
      runOverviewWithOptions({ cwd: env.repo, homeDir: env.home, json: true }),
    );

    expect(code).toBe(0);
    const payload = JSON.parse(out.trim());
    expect(payload).toEqual({
      notes: {
        total: 1,
        count: 1,
        truncated: false,
        items: [
          {
            path: notePath,
            relativePath: "phase-1.md",
            fileUri: pathToFileURL(notePath).href,
          },
        ],
      },
      handoffs: {
        total: 1,
        count: 1,
        truncated: false,
        items: [
          {
            path: handoffPath,
            relativePath: "2026-06-26-120000-session.md",
            fileUri: pathToFileURL(handoffPath).href,
          },
        ],
      },
      plans: {
        total: 1,
        count: 1,
        truncated: false,
        items: [
          {
            path: planPath,
            relativePath: "auth-rewrite.md",
            fileUri: pathToFileURL(planPath).href,
          },
        ],
      },
    });
  });

  it("reports an honest total and only flags truncated past the limit", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const notesDir = path.join(env.vault, "10-Projects", "my-app", "notes");
    const a = path.join(notesDir, "a.md");
    const b = path.join(notesDir, "b.md");
    await writeFile(a, "a", "utf8");
    await writeFile(b, "b", "utf8");
    await touch(a, new Date("2026-06-26T13:00:00.000Z"));
    await touch(b, new Date("2026-06-26T14:00:00.000Z"));

    // Exactly `limit` notes: count === total, not truncated (boundary case
    // the plain-text "there may be more" header conflates but --json must not).
    const exact = await captureStdout(() =>
      runOverviewWithOptions({ cwd: env.repo, homeDir: env.home, json: true, limit: 2 }),
    );
    const exactPayload = JSON.parse(exact.out.trim());
    expect(exactPayload.notes).toMatchObject({ total: 2, count: 2, truncated: false });

    // Fewer than `limit`: same, not truncated.
    const under = await captureStdout(() =>
      runOverviewWithOptions({ cwd: env.repo, homeDir: env.home, json: true, limit: 5 }),
    );
    const underPayload = JSON.parse(under.out.trim());
    expect(underPayload.notes).toMatchObject({ total: 2, count: 2, truncated: false });

    // More than `limit`: total stays the real count, only shown items are capped.
    const capped = await captureStdout(() =>
      runOverviewWithOptions({ cwd: env.repo, homeDir: env.home, json: true, limit: 1 }),
    );
    const cappedPayload = JSON.parse(capped.out.trim());
    expect(cappedPayload.notes).toMatchObject({ total: 2, count: 1, truncated: true });
  });

  it("returns usage error for invalid --limit", async () => {
    expect(await runOverview(["--limit", "abc"])).toBe(1);
    expect(await runOverview(["--limit", "0"])).toBe(1);
    expect(await runOverview(["--limit"])).toBe(1);
    expect(await runOverview(["--limit", "-1"])).toBe(1);
    expect(await runOverview(["--unknown"])).toBe(1);
  });

  it("returns usage error for unexpected positionals", async () => {
    expect(await runOverview(["remaining", "work"])).toBe(1);
  });

  it("rejects combining --markdown and --json", async () => {
    expect(await runOverview(["--markdown", "--json"])).toBe(1);
  });

  it("finds link walking up from a nested cwd", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const notesDir = path.join(env.vault, "10-Projects", "my-app", "notes");
    const notePath = path.join(notesDir, "phase-1.md");
    await writeFile(notePath, "x", "utf8");

    const nested = path.join(env.repo, "src", "nested");
    await mkdir(nested, { recursive: true });

    const { code, out } = await captureStdout(() =>
      runOverviewWithOptions({ cwd: nested, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("All 1 note:\n\n1. phase-1  \n");
  });

  it("cli prints per-bucket sections and honors --limit", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const notesDir = path.join(env.vault, "10-Projects", "my-app", "notes");
    const older = path.join(notesDir, "older.md");
    const newer = path.join(notesDir, "newer.md");
    await writeFile(older, "a", "utf8");
    await writeFile(newer, "b", "utf8");
    await touch(older, new Date("2026-06-26T13:00:00.000Z"));
    await touch(newer, new Date("2026-06-26T15:00:00.000Z"));

    const result = runCli(["overview", "--limit", "1"], withGroundedHome(env.home), env.repo);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Most recent 1 note (there may be more):\n\n1. newer  \n");
    expect(result.stdout).toContain("Handoffs\nNo handoffs.\n");
    expect(result.stdout).toContain("Plans\nNo plans.\n");
  });

  it("returns 1 when the project is not linked", async () => {
    const env = await createTempEnv({ packageName: "my-app", initGit: true });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });

    const { code } = await captureStdout(() =>
      runOverviewWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(1);
  });
});
