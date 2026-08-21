import { spawnSync } from "node:child_process";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runLinkWithOptions } from "../../../src/commands/link.js";
import { runNoteList, runNoteListWithOptions } from "../../../src/commands/note/list.js";
import { runSetupWithOptions } from "../../../src/commands/setup.js";
import { captureStdout, createTempEnv, withGroundedHome } from "../../helpers.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = path.join(pkgRoot, "dist", "cli.js");

function runCli(args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, cwd });
}

async function touch(filePath: string, when: Date): Promise<void> {
  await utimes(filePath, when, when);
}

describe("commands/note/list", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("prints newest notes first as numbered title + path blocks", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const notesDir = path.join(env.vault, "10-Projects", "my-app", "notes");
    const older = path.join(notesDir, "older.md");
    const newer = path.join(notesDir, "2026-06-26-document 1.md");
    await writeFile(older, "older", "utf8");
    await writeFile(newer, "newer", "utf8");
    await touch(older, new Date("2026-06-26T14:00:00.000Z"));
    await touch(newer, new Date("2026-06-26T15:00:00.000Z"));

    const { code, out } = await captureStdout(() =>
      runNoteListWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe(
      `All 2 notes:\n\n1. 2026-06-26-document 1  \n  ${newer}\n\n2. older  \n  ${older}\n`,
    );
  });

  it("prints No notes. and exits 0 when notes are empty", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runNoteListWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe("No notes.\n");
  });

  it("respects --limit and signals possible truncation", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const notesDir = path.join(env.vault, "10-Projects", "my-app", "notes");
    const a = path.join(notesDir, "a.md");
    const b = path.join(notesDir, "b.md");
    const c = path.join(notesDir, "c.md");
    await writeFile(a, "a", "utf8");
    await writeFile(b, "b", "utf8");
    await writeFile(c, "c", "utf8");
    await touch(a, new Date("2026-06-26T13:00:00.000Z"));
    await touch(b, new Date("2026-06-26T14:00:00.000Z"));
    await touch(c, new Date("2026-06-26T15:00:00.000Z"));

    const { code, out } = await captureStdout(() =>
      runNoteListWithOptions({ cwd: env.repo, homeDir: env.home, limit: 1 }),
    );

    expect(code).toBe(0);
    expect(out).toBe(`Most recent 1 note (there may be more):\n\n1. c  \n  ${c}\n`);
  });

  it("cli prints count header + numbered blocks and honors --limit", async () => {
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

    const result = runCli(["note", "list", "--limit", "1"], withGroundedHome(env.home), env.repo);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      `Most recent 1 note (there may be more):\n\n1. newer  \n  ${newer}\n`,
    );
  });

  it("returns usage error for invalid --limit", async () => {
    expect(await runNoteList(["--limit", "abc"])).toBe(1);
    expect(await runNoteList(["--limit", "0"])).toBe(1);
    expect(await runNoteList(["--limit"])).toBe(1);
    expect(await runNoteList(["--limit", "-1"])).toBe(1);
    expect(await runNoteList(["--unknown"])).toBe(1);
  });

  it("returns usage error for unexpected positionals", async () => {
    const code = await runNoteList(["remaining", "work"]);
    expect(code).toBe(1);
  });

  it("finds link walking up from a nested cwd", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const notesDir = path.join(env.vault, "10-Projects", "my-app", "notes");
    const notePath = path.join(notesDir, "phase-1.md");
    await writeFile(notePath, "x", "utf8");

    const nested = path.join(env.repo, "src", "nested");
    await mkdir(nested, { recursive: true });

    const { code, out } = await captureStdout(() =>
      runNoteListWithOptions({ cwd: nested, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe(`All 1 note:\n\n1. phase-1  \n  ${notePath}\n`);
  });

  it("prints markdown link title lines with --markdown", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const notesDir = path.join(env.vault, "10-Projects", "my-app", "notes");
    const notePath = path.join(notesDir, "phase-1.md");
    await writeFile(notePath, "x", "utf8");

    const { code, out } = await captureStdout(() =>
      runNoteListWithOptions({ cwd: env.repo, homeDir: env.home, markdown: true }),
    );

    expect(code).toBe(0);
    expect(out).toBe(
      `All 1 note:\n\n1. [phase-1.md](${pathToFileURL(notePath).href})  \n  ${notePath}\n`,
    );
  });
});
