import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runHandoffList, runHandoffListWithOptions } from "../../../src/commands/handoff/list.js";
import { runLinkWithOptions } from "../../../src/commands/link.js";
import { runSetupWithOptions } from "../../../src/commands/setup.js";
import { captureStdout, createTempEnv, withGroundedHome } from "../../helpers.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = path.join(pkgRoot, "dist", "cli.js");

function runCli(args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, cwd });
}

describe("commands/handoff/list", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("prints newest handoffs first as numbered title + path blocks", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    const older = path.join(logsDir, "2026-06-26-1430.md");
    const newer = path.join(logsDir, "2026-06-26-1500-newer.md");
    await writeFile(older, "older", "utf8");
    await writeFile(newer, "newer", "utf8");

    const { code, out } = await captureStdout(() =>
      runHandoffListWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe(
      `All 2 handoffs:\n\n1. 2026-06-26-1500-newer  \n  ${newer}\n\n2. 2026-06-26-1430  \n  ${older}\n`,
    );
  });

  it("prints No handoffs. and exits 0 when logs are empty", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runHandoffListWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe("No handoffs.\n");
  });

  it("respects --limit and signals possible truncation", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    const a = path.join(logsDir, "2026-06-26-1300.md");
    const b = path.join(logsDir, "2026-06-26-1400.md");
    const c = path.join(logsDir, "2026-06-26-1500.md");
    await writeFile(a, "a", "utf8");
    await writeFile(b, "b", "utf8");
    await writeFile(c, "c", "utf8");

    const { code, out } = await captureStdout(() =>
      runHandoffListWithOptions({ cwd: env.repo, homeDir: env.home, limit: 1 }),
    );

    expect(code).toBe(0);
    expect(out).toBe(
      `Most recent 1 handoff (there may be more):\n\n1. 2026-06-26-1500  \n  ${c}\n`,
    );
  });

  it("cli prints count header + numbered blocks and honors --limit", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await writeFile(path.join(logsDir, "2026-06-26-1300.md"), "a", "utf8");
    const newer = path.join(logsDir, "2026-06-26-1500.md");
    await writeFile(newer, "b", "utf8");

    const result = runCli(
      ["handoff", "list", "--limit", "1"],
      withGroundedHome(env.home),
      env.repo,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      `Most recent 1 handoff (there may be more):\n\n1. 2026-06-26-1500  \n  ${newer}\n`,
    );
  });

  it("returns usage error for invalid --limit", async () => {
    expect(await runHandoffList(["--limit", "abc"])).toBe(1);
    expect(await runHandoffList(["--limit", "0"])).toBe(1);
    expect(await runHandoffList(["--limit"])).toBe(1);
    expect(await runHandoffList(["--limit", "-1"])).toBe(1);
    expect(await runHandoffList(["--unknown"])).toBe(1);
  });

  it("rejects --head together with --markdown", async () => {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      expect(await runHandoffList(["--head", "--markdown"])).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect(chunks.join("")).toContain("Use only one of --head or --markdown.");
  });

  it("--head prints only the newest usable path", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await writeFile(path.join(logsDir, "2026-06-26-1400-older.md"), "older", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-1500-newer.md"), "newer", "utf8");

    const { code, out } = await captureStdout(() =>
      runHandoffListWithOptions({ cwd: env.repo, homeDir: env.home, head: true }),
    );

    expect(code).toBe(0);
    expect(out).toBe(`${path.join(logsDir, "2026-06-26-1500-newer.md")}\n`);
  });

  it("--head falls back past an empty newest handoff", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await writeFile(path.join(logsDir, "2026-06-26-1400-older.md"), "older", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-1500-empty.md"), "", "utf8");

    const { code, out } = await captureStdout(() =>
      runHandoffListWithOptions({ cwd: env.repo, homeDir: env.home, head: true }),
    );

    expect(code).toBe(0);
    expect(out).toBe(`${path.join(logsDir, "2026-06-26-1400-older.md")}\n`);
  });

  it("--head prints nothing when there are no handoffs", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runHandoffListWithOptions({ cwd: env.repo, homeDir: env.home, head: true }),
    );

    expect(code).toBe(0);
    expect(out).toBe("");
  });

  it("cli accepts --head", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await writeFile(path.join(logsDir, "2026-06-26-1500.md"), "content", "utf8");

    const result = runCli(["handoff", "list", "--head"], withGroundedHome(env.home), env.repo);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(path.join(logsDir, "2026-06-26-1500.md"));
  });

  it("returns usage error for unexpected positionals", async () => {
    const code = await runHandoffList(["remaining", "work"]);
    expect(code).toBe(1);
  });

  it("finds link walking up from a nested cwd", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    const handoffPath = path.join(logsDir, "2026-06-26-1500.md");
    await writeFile(handoffPath, "x", "utf8");

    const nested = path.join(env.repo, "src", "nested");
    await mkdir(nested, { recursive: true });

    const { code, out } = await captureStdout(() =>
      runHandoffListWithOptions({ cwd: nested, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe(`All 1 handoff:\n\n1. 2026-06-26-1500  \n  ${handoffPath}\n`);
  });

  it("prints markdown link title lines with --markdown", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    const handoffPath = path.join(logsDir, "2026-06-26-1500.md");
    await writeFile(handoffPath, "x", "utf8");

    const { code, out } = await captureStdout(() =>
      runHandoffListWithOptions({ cwd: env.repo, homeDir: env.home, markdown: true }),
    );

    expect(code).toBe(0);
    expect(out).toBe(
      `All 1 handoff:\n\n1. [2026-06-26-1500.md](${pathToFileURL(handoffPath).href})  \n  ${handoffPath}\n`,
    );
  });
});
