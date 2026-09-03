import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { grounderNoteCommandPath as claudeNoteCommandPath } from "../../src/agents/claude.js";
import { cursorHooksJsonPath, grounderNoteCommandPath } from "../../src/agents/cursor.js";
import { runtimeCliPath } from "../../src/agents/hook-runtime.js";
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
import { captureStdout, createTempEnv, hasRow } from "../helpers.js";

function legacyCursorNotePath(homeDir: string): string {
  return path.join(homeDir, ".cursor", "commands", "grounder-note.md");
}

function legacyClaudeNotePath(homeDir: string): string {
  return path.join(homeDir, ".claude", "commands", "grounder-note.md");
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

  it("reports nothing to do when the install is already current", async () => {
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
    expect(out).toContain("Nothing to do");
    expect(hasRow(out, "unchanged", statePath(env.home))).toBe(true);
    expect(hasRow(out, "unchanged", runtimeCliPath(env.home))).toBe(true);
  });

  it("does not report state.json as updated when only its on-disk key order differs", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      hooks: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    const state = await readGrounderState(env.home);
    const cursorAgent = state?.agents.cursor;
    if (!cursorAgent) {
      throw new Error("expected cursor agent in install state after setup");
    }
    // Same data, `hooksSchema` before `files` — simulates a ledger entry
    // written by an older Grounder whose field order doesn't match today's
    // `recordAgentInstall` (which writes `files` before `hooksSchema`).
    const reordered = {
      ...state,
      agents: {
        ...state.agents,
        cursor: {
          commandsSchema: cursorAgent.commandsSchema,
          hooksSchema: cursorAgent.hooksSchema,
          files: cursorAgent.files,
        },
      },
    };
    await writeFile(statePath(env.home), `${JSON.stringify(reordered, null, 2)}\n`, "utf8");

    const { code, out } = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));

    expect(code).toBe(0);
    expect(hasRow(out, "unchanged", statePath(env.home))).toBe(true);
  });

  it("dry-run reports state.json as unchanged when the only pending row is a conflict", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    // A left-alone conflict never calls any `recordAgentInstall*` — it must
    // not make the ledger row look like it's about to change either.
    await writeFile(grounderNoteCommandPath(env.home), "my local edits\n", "utf8");

    const { code, out } = await captureStdout(() =>
      runMigrateWithOptions({ homeDir: env.home, dryRun: true }),
    );

    expect(code).toBe(0);
    expect(hasRow(out, "conflict", grounderNoteCommandPath(env.home))).toBe(true);
    expect(hasRow(out, "unchanged", statePath(env.home))).toBe(true);
    // A conflict is pending work — the summary must not claim there's nothing
    // to do just because nothing was created/updated/deleted.
    expect(out).not.toContain("Nothing to do");
    expect(out).toContain("left as a conflict");
    // Nothing would actually be created/updated/deleted by re-running without
    // --dry-run when the only pending row is a conflict — --force is what
    // resolves it, so the summary must not tell the reader to drop --dry-run.
    expect(out).not.toContain("Run without --dry-run to apply");
    expect(out).toContain("Run with --force to resolve");
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

  it("does not advance commandsSchema when plain migrate skips all locally-modified skill files", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    // Pre-0.3 / pre-ledger: skill files exist with drift Grounder can't
    // verify (no per-file hashes) — content differing from the current
    // template is what actually needs protecting, so simulate that rather
    // than leaving the freshly-installed (already-matching) content in place.
    const { cursor } = await import("../../src/agents/cursor.js");
    for (const filePath of cursor.expectedArtifacts(env.home)) {
      const original = await readFile(filePath, "utf8");
      await writeFile(filePath, `${original}\n<!-- local edit -->\n`, "utf8");
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
    expect(hasRow(out, "unchanged", cursorHooksJsonPath(env.home), "cursor hook")).toBe(true);
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
    // The ledger already recorded the template's hash for this path from the
    // original `setup` (the test only rewrote the file on disk, not via
    // Grounder) — force-restoring it to that same template content changes
    // the file but not what the ledger would record for it, so `state` is
    // correctly `unchanged` here, not `updated`.
    expect(hasRow(out, "unchanged", statePath(env.home))).toBe(true);
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

    it("distinguishes overwrite vs delete in the --force footer for a mixed run", async () => {
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

      const legacyPath = legacyCursorNotePath(env.home);
      await mkdir(path.dirname(legacyPath), { recursive: true });
      await writeFile(legacyPath, "hand-edited legacy command\n", "utf8");

      const { code, out } = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));

      expect(code).toBe(0);
      expect(out).toContain(`  ${noteDest} (would be overwritten)`);
      expect(out).toContain(`  ${legacyPath} (would be deleted)`);
      expect(out).toContain("Run 'grounder migrate --force' to overwrite or delete them");
    });

    it("forgets a stale ledger entry for a legacy file already gone from disk", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await runSetupWithOptions({
        vaultPath: env.vault,
        yes: true,
        homeDir: env.home,
        agents: ["cursor"],
      });
      const legacyPath = legacyCursorNotePath(env.home);
      // Ledger still remembers a hash for this path, but the file itself is
      // already gone (e.g. removed outside `migrate`).
      await recordAgentInstall({
        agentId: "cursor",
        grounderVersion: "0.5.0",
        files: { [legacyPath]: { hash: hashContent("old pre-skill note command\n") } },
        homeDir: env.home,
      });
      expect(await fileExists(legacyPath)).toBe(false);

      const { code, out } = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));

      expect(code).toBe(0);
      expect(hasRow(out, "deleted", legacyPath)).toBe(false);
      // The file was already gone, so nothing was created/updated/deleted on
      // disk — but the ledger's stale hash for it was dropped, which is what
      // makes the trailing `state` row report "updated". Surface that here so
      // the state-row change isn't unexplained.
      expect(hasRow(out, "updated", `${legacyPath} (stale ledger entry)`)).toBe(true);
      const state = await readGrounderState(env.home);
      expect(state?.agents.cursor?.files ?? {}).not.toHaveProperty(legacyPath);
    });

    it("dry-run leaves a stale ledger entry untouched for an already-absent legacy file", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await runSetupWithOptions({
        vaultPath: env.vault,
        yes: true,
        homeDir: env.home,
        agents: ["cursor"],
      });
      const legacyPath = legacyCursorNotePath(env.home);
      await recordAgentInstall({
        agentId: "cursor",
        grounderVersion: "0.5.0",
        files: { [legacyPath]: { hash: hashContent("old pre-skill note command\n") } },
        homeDir: env.home,
      });

      const { code } = await captureStdout(() =>
        runMigrateWithOptions({ homeDir: env.home, dryRun: true }),
      );

      expect(code).toBe(0);
      const state = await readGrounderState(env.home);
      expect(state?.agents.cursor?.files ?? {}).toHaveProperty(legacyPath);
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

    it("groups each agent's legacy-retirement row with that agent's own rows, not after every agent's rows", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await runSetupWithOptions({
        vaultPath: env.vault,
        yes: true,
        homeDir: env.home,
        agents: ["cursor", "claude"],
      });

      // A retirable legacy leftover for both agents, hash matching the
      // ledger so both retire cleanly (no conflict).
      for (const [agentId, legacyPath] of [
        ["cursor", legacyCursorNotePath(env.home)],
        ["claude", legacyClaudeNotePath(env.home)],
      ] as const) {
        await mkdir(path.dirname(legacyPath), { recursive: true });
        const legacyContent = `old pre-skill ${agentId} note command\n`;
        await writeFile(legacyPath, legacyContent, "utf8");
        await recordAgentInstall({
          agentId,
          grounderVersion: "0.5.0",
          files: { [legacyPath]: { hash: hashContent(legacyContent) } },
          homeDir: env.home,
        });
      }

      const { code, out } = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));

      expect(code).toBe(0);
      expect(hasRow(out, "deleted", legacyCursorNotePath(env.home), "cursor")).toBe(true);
      expect(hasRow(out, "deleted", legacyClaudeNotePath(env.home), "claude")).toBe(true);

      // cursor's legacy row must land before claude's own rows start, not
      // after all of claude's rows — i.e. grouped per agent, not appended in
      // one trailing block after every agent.
      const cursorLegacyIndex = out.indexOf(legacyCursorNotePath(env.home));
      const claudeOwnRowIndex = out.indexOf(claudeNoteCommandPath(env.home));
      expect(cursorLegacyIndex).toBeGreaterThan(-1);
      expect(claudeOwnRowIndex).toBeGreaterThan(-1);
      expect(cursorLegacyIndex).toBeLessThan(claudeOwnRowIndex);
    });
  });
});
