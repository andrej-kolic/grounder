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

/** True when the migrate table has a row with this exact status and path. */
function hasRow(out: string, status: string, artifactPath: string): boolean {
  return out.split("\n").some((line) => {
    const trimmed = line.trimEnd();
    if (!trimmed.endsWith(artifactPath)) {
      return false;
    }
    return trimmed.trim().split(/\s+/)[0] === status;
  });
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
    expect(out).toContain("unchanged");
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
    expect(hasRow(skipped.out, "conflict", noteDest)).toBe(true);
    expect(skipped.out).toContain("left alone");
    expect(skipped.out).toContain("grounder migrate --force");
    expect(await readFile(noteDest, "utf8")).toBe("my local edits\n");

    const forced = await captureStdout(() =>
      runMigrateWithOptions({ homeDir: env.home, force: true }),
    );
    expect(forced.code).toBe(0);
    expect(hasRow(forced.out, "updated", noteDest)).toBe(true);
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
    // Pre-0.3 / pre-ledger: command files exist with drift Grounder can't
    // verify (no per-file hashes) — content differing from the current
    // template is what actually needs protecting, so simulate that rather
    // than leaving the freshly-installed (already-matching) content in place.
    const { cursor } = await import("../../src/agents/cursor.js");
    for (const filePath of cursor.expectedArtifacts(env.home)) {
      const original = await readFile(filePath, "utf8");
      await writeFile(filePath, `${original}\n<!-- legacy -->\n`, "utf8");
    }
    const { rm } = await import("node:fs/promises");
    await rm(statePath(env.home), { force: true });

    const { code, out } = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));

    expect(code).toBe(0);
    expect(out).toContain("5 files left alone");
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
    expect(hasRow(out, "unchanged", cursorHooksJsonPath(env.home))).toBe(true);
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
    expect(out).not.toContain(cursorHooksJsonPath(env.home));
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
    expect(out).toContain("Dry run — no files will be written.");
    expect(hasRow(out, "updated", noteDest)).toBe(true);
    expect(
      out.indexOf(
        "Refresh Grounder after an upgrade (slash commands/hooks; vault path unchanged).",
      ),
    ).toBeLessThan(out.indexOf("Dry run — no files will be written."));
    expect(hasRow(out, "updated", statePath(env.home))).toBe(true);
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
    expect(hasRow(out, "created", statePath(env.home))).toBe(true);
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
      expect(out).toContain("unchanged");
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
      expect(hasRow(out, "deleted", legacyPath)).toBe(true);
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
      expect(out).toContain("1 file left alone");
      expect(out).toContain(`  ${legacyPath}`);
      expect(out).toContain("grounder migrate --force");
      expect(await fileExists(legacyPath)).toBe(true);

      const forced = await captureStdout(() =>
        runMigrateWithOptions({ homeDir: env.home, force: true }),
      );
      expect(forced.code).toBe(0);
      expect(hasRow(forced.out, "deleted", legacyPath)).toBe(true);
      expect(await fileExists(legacyPath)).toBe(false);
      expect(forced.out).not.toContain("left alone");
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
      expect(hasRow(out, "deleted", legacyPath)).toBe(true);
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
