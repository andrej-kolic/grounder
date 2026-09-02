import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cursorHooksJsonPath, grounderNoteCommandPath } from "../../src/agents/cursor.js";
import { runMigrateWithOptions } from "../../src/commands/migrate.js";
import { runSetupWithOptions } from "../../src/commands/setup.js";
import {
  readGrounderState,
  recordAgentInstall,
  statePath,
  writeGrounderState,
} from "../../src/connector/state.js";
import { fileExists } from "../../src/util/fs.js";
import { hashContent } from "../../src/util/hash.js";
import { captureStdout, createTempEnv } from "../helpers.js";

function legacyCursorNotePath(homeDir: string): string {
  return path.join(homeDir, ".cursor", "commands", "grounder-note.md");
}

describe("commands/migrate", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("requires home config", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const chunks: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      const code = await runMigrateWithOptions({ homeDir: env.home });
      expect(code).toBe(1);
      expect(chunks.join("")).toContain("grounder setup <path>");
    } finally {
      spy.mockRestore();
    }
  });

  it("refreshes commands from the install ledger", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    const { code, out } = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));

    expect(code).toBe(0);
    expect(out).toContain(`Vault root: ${env.vault}`);
    expect(out).toContain("skill files already current");
    expect(await readGrounderState(env.home)).toMatchObject({
      agents: { cursor: { commandsSchema: 4 } },
    });
  });

  it("reports locally modified files and overwrites with --force", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    const noteDest = grounderNoteCommandPath(env.home);
    await writeFile(noteDest, "my local edits\n", "utf8");

    const skipped = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));
    expect(skipped.code).toBe(0);
    expect(skipped.out).toContain("locally modified (skipped — use --force)");
    expect(skipped.out).toContain("grounder migrate --force");
    expect(await readFile(noteDest, "utf8")).toBe("my local edits\n");

    const forced = await captureStdout(() =>
      runMigrateWithOptions({ homeDir: env.home, force: true }),
    );
    expect(forced.code).toBe(0);
    expect(forced.out).toContain(`updated: ${noteDest}`);
    expect(await readFile(noteDest, "utf8")).not.toBe("my local edits\n");
  });

  it("does not advance commandsSchema when plain migrate skips all legacy command files", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    // Pre-0.3 / pre-ledger: command files exist, but no per-file hashes.
    const { rm } = await import("node:fs/promises");
    await rm(statePath(env.home), { force: true });

    const { code, out } = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));

    expect(code).toBe(0);
    expect(out).toContain("locally modified (skipped — use --force)");
    expect(out).toContain("grounder migrate --force");

    const state = await readGrounderState(env.home);
    expect(state).toMatchObject({
      grounderVersion: expect.any(String),
      agents: { cursor: { commandsSchema: 0 } },
    });
    expect(state?.agents.cursor?.files ?? {}).toEqual({});

    const forced = await captureStdout(() =>
      runMigrateWithOptions({ homeDir: env.home, force: true }),
    );
    expect(forced.code).toBe(0);
    expect(await readGrounderState(env.home)).toMatchObject({
      agents: { cursor: { commandsSchema: 4 } },
    });
    expect(
      Object.keys((await readGrounderState(env.home))?.agents.cursor?.files ?? {}).length,
    ).toBeGreaterThan(0);
  });

  it("refreshes previously installed hooks without --hooks", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      hooks: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    const { code, out } = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));

    expect(code).toBe(0);
    expect(out).toMatch(/Will refresh:\n(.|\n)*cursor {3}.*hooks\.json/);
    expect(out).toMatch(/Cursor: 1 hook file already current/);
    expect(await fileExists(cursorHooksJsonPath(env.home))).toBe(true);
  });

  it("does not install hooks that were never opted in", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    const { code, out } = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));

    expect(code).toBe(0);
    expect(out).not.toMatch(/Cursor hook /);
    expect(out).toContain("hooks    none previously installed (pass --hooks to install)");
    expect(await fileExists(cursorHooksJsonPath(env.home))).toBe(false);
  });

  it("dry-run previews without writing", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    const noteDest = grounderNoteCommandPath(env.home);
    await writeFile(noteDest, "my local edits\n", "utf8");
    const before = await readFile(noteDest, "utf8");

    const { code, out } = await captureStdout(() =>
      runMigrateWithOptions({ homeDir: env.home, force: true, dryRun: true }),
    );

    expect(code).toBe(0);
    expect(out).toContain(
      "Refresh Grounder after an upgrade (slash commands/hooks; vault path unchanged).",
    );
    expect(out).toContain("Would refresh:");
    expect(out).not.toContain("Dry run");
    expect(out).not.toContain("Will refresh:");
    expect(out).toContain("would update:");
    expect(
      out.indexOf(
        "Refresh Grounder after an upgrade (slash commands/hooks; vault path unchanged).",
      ),
    ).toBeLessThan(out.indexOf("Would refresh:"));
    expect(out).toContain(`Install state would update: ${statePath(env.home)}`);
    expect(out).not.toContain("grounder migrate --force");
    expect(await readFile(noteDest, "utf8")).toBe(before);
  });

  it("dry-run mentions creating install state when the ledger is missing", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    const { rm } = await import("node:fs/promises");
    await rm(statePath(env.home), { force: true });

    const { code, out } = await captureStdout(() =>
      runMigrateWithOptions({ homeDir: env.home, dryRun: true }),
    );

    expect(code).toBe(0);
    expect(out).toContain(`  state    ${statePath(env.home)}`);
    expect(out).toContain(`Install state would create: ${statePath(env.home)}`);
  });

  it("skips unknown ledger agent ids and still migrates known ones", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    const state = await readGrounderState(env.home);
    if (!state) {
      throw new Error("expected install state after setup");
    }
    await writeGrounderState(
      {
        ...state,
        agents: {
          ...state.agents,
          // Future Grounder agent — older binary must not crash migrate.
          windsurf: { commandsSchema: 1, files: {} },
        },
      },
      env.home,
    );

    const errChunks: string[] = [];
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      errChunks.push(String(chunk));
      return true;
    });
    try {
      const { code, out } = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));
      expect(code).toBe(0);
      expect(out).toContain("skill files already current");
      expect(errChunks.join("")).toContain("Skipping unknown agent(s) in install state: windsurf");
      expect(errChunks.join("")).toContain("Upgrade grounder");
    } finally {
      errSpy.mockRestore();
    }

    expect(await readGrounderState(env.home)).toMatchObject({
      agents: {
        cursor: { commandsSchema: 4 },
        windsurf: { commandsSchema: 1 },
      },
    });
  });

  it("still rejects unknown ids passed via --agent", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    await expect(
      runMigrateWithOptions({ homeDir: env.home, agents: ["windsurf"] }),
    ).rejects.toThrow("Unknown agent id(s): windsurf");
  });

  it("refuses to migrate when recorded schemas are newer than this grounder", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await writeGrounderState(
      {
        grounderVersion: "9.9.9",
        agents: {
          cursor: { commandsSchema: 99, files: {} },
        },
      },
      env.home,
    );

    const chunks: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      const { code } = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));
      expect(code).toBe(1);
      expect(chunks.join("")).toContain("Upgrade grounder");
      expect(chunks.join("")).toContain("commands schema 99");
    } finally {
      spy.mockRestore();
    }

    expect(await readGrounderState(env.home)).toMatchObject({
      agents: { cursor: { commandsSchema: 99 } },
    });
  });

  it("refuses to migrate when install state JSON is corrupt", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await writeFile(statePath(env.home), "{/\n", "utf8");

    await expect(runMigrateWithOptions({ homeDir: env.home, dryRun: true })).rejects.toThrow(
      /Invalid grounder state.*migrate --force/,
    );
  });

  describe("legacy command retirement", () => {
    it("retires a legacy pre-skill command file whose hash matches the ledger", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await runSetupWithOptions({
        vaultPath: env.vault,
        yes: true,
        homeDir: env.home,
        agents: ["cursor"],
      });
      const legacyPath = legacyCursorNotePath(env.home);
      await mkdir(path.dirname(legacyPath), { recursive: true });
      const legacyContent = "old pre-skill note command\n";
      await writeFile(legacyPath, legacyContent, "utf8");
      await recordAgentInstall({
        agentId: "cursor",
        grounderVersion: "0.5.0",
        files: { [legacyPath]: { hash: hashContent(legacyContent) } },
        homeDir: env.home,
      });

      const { code, out } = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));

      expect(code).toBe(0);
      expect(out).toContain(`Deleted old command file: ${legacyPath}`);
      expect(await fileExists(legacyPath)).toBe(false);
    });

    it("leaves a locally modified legacy command file without --force", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await runSetupWithOptions({
        vaultPath: env.vault,
        yes: true,
        homeDir: env.home,
        agents: ["cursor"],
      });
      const legacyPath = legacyCursorNotePath(env.home);
      await mkdir(path.dirname(legacyPath), { recursive: true });
      await writeFile(legacyPath, "hand-edited legacy command\n", "utf8");

      const { code, out } = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));

      expect(code).toBe(0);
      expect(out).toContain("1 old command file left in place");
      expect(out).toContain(`  ${legacyPath}`);
      expect(out).toContain("grounder migrate --force");
      expect(await fileExists(legacyPath)).toBe(true);

      const forced = await captureStdout(() =>
        runMigrateWithOptions({ homeDir: env.home, force: true }),
      );
      expect(forced.code).toBe(0);
      expect(forced.out).toContain(`Deleted old command file: ${legacyPath}`);
      expect(await fileExists(legacyPath)).toBe(false);
      expect(forced.out).not.toContain("left in place");
    });

    it("dry-run reports the retirement without deleting", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await runSetupWithOptions({
        vaultPath: env.vault,
        yes: true,
        homeDir: env.home,
        agents: ["cursor"],
      });
      const legacyPath = legacyCursorNotePath(env.home);
      await mkdir(path.dirname(legacyPath), { recursive: true });
      const legacyContent = "old pre-skill note command\n";
      await writeFile(legacyPath, legacyContent, "utf8");
      await recordAgentInstall({
        agentId: "cursor",
        grounderVersion: "0.5.0",
        files: { [legacyPath]: { hash: hashContent(legacyContent) } },
        homeDir: env.home,
      });

      const { code, out } = await captureStdout(() =>
        runMigrateWithOptions({ homeDir: env.home, dryRun: true }),
      );

      expect(code).toBe(0);
      expect(out).toContain(`Would delete old command file: ${legacyPath}`);
      expect(await fileExists(legacyPath)).toBe(true);
    });

    it("grounder setup never touches legacy command files", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const legacyPath = legacyCursorNotePath(env.home);
      await mkdir(path.dirname(legacyPath), { recursive: true });
      await writeFile(legacyPath, "pre-existing legacy file\n", "utf8");

      await runSetupWithOptions({
        vaultPath: env.vault,
        yes: true,
        homeDir: env.home,
        agents: ["cursor"],
      });

      expect(await fileExists(legacyPath)).toBe(true);
      expect(await readFile(legacyPath, "utf8")).toBe("pre-existing legacy file\n");
    });
  });
});
