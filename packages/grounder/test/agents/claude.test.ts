import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claude,
  grounderNoteCommandPath,
  grounderTaskHandoffCommandPath,
} from "../../src/agents/claude.js";
import { createTempEnv } from "../helpers.js";

describe("agents/claude", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  describe("command paths", () => {
    it("returns paths inside .claude/commands/", () => {
      expect(grounderNoteCommandPath("/home/user")).toBe(
        "/home/user/.claude/commands/grounder-note.md",
      );
      expect(grounderTaskHandoffCommandPath("/home/user")).toBe(
        "/home/user/.claude/commands/grounder-task-handoff.md",
      );
    });
  });

  describe("claude.install", () => {
    it("creates note and handoff command files", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const result = await claude.install({ homeDir: env.home });
      const noteDest = grounderNoteCommandPath(env.home);
      const handoffDest = grounderTaskHandoffCommandPath(env.home);

      expect(result.artifacts[noteDest]).toBe("created");
      expect(result.artifacts[handoffDest]).toBe("created");
      await access(noteDest);
      await access(handoffDest);
      expect(await readFile(noteDest, "utf8")).toContain("npx grounder note");
      expect(await readFile(handoffDest, "utf8")).toContain("npx grounder handoff");
    });

    it("skips existing files and creates missing ones", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const noteDest = grounderNoteCommandPath(env.home);
      await mkdir(path.dirname(noteDest), { recursive: true });
      await writeFile(noteDest, "custom note command\n", "utf8");

      const result = await claude.install({ homeDir: env.home });
      const handoffDest = grounderTaskHandoffCommandPath(env.home);

      expect(result.artifacts[noteDest]).toBe("skipped");
      expect(result.artifacts[handoffDest]).toBe("created");
      expect(await readFile(noteDest, "utf8")).toBe("custom note command\n");
      expect(await readFile(handoffDest, "utf8")).toContain("npx grounder handoff");
    });

    it("skips if already exists and force is false", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await claude.install({ homeDir: env.home });
      const result = await claude.install({ homeDir: env.home });
      const noteDest = grounderNoteCommandPath(env.home);
      const handoffDest = grounderTaskHandoffCommandPath(env.home);

      expect(result.artifacts[noteDest]).toBe("skipped");
      expect(result.artifacts[handoffDest]).toBe("skipped");
    });

    it("overwrites if force is true", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await claude.install({ homeDir: env.home });
      const result = await claude.install({ homeDir: env.home, force: true });
      const noteDest = grounderNoteCommandPath(env.home);
      const handoffDest = grounderTaskHandoffCommandPath(env.home);

      expect(result.artifacts[noteDest]).toBe("overwritten");
      expect(result.artifacts[handoffDest]).toBe("overwritten");
    });
  });

  describe("claude.isInstalled", () => {
    it("returns false when .claude dir does not exist", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const prev = process.env.GROUNDER_HOME;
      process.env.GROUNDER_HOME = env.home;
      try {
        expect(await claude.isInstalled()).toBe(false);
      } finally {
        if (prev === undefined) delete process.env.GROUNDER_HOME;
        else process.env.GROUNDER_HOME = prev;
      }
    });
  });
});
