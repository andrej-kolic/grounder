import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claude, grounderNoteCommandPath } from "../../src/agents/claude.js";
import { createTempEnv } from "../helpers.js";

describe("agents/claude", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  describe("grounderNoteCommandPath", () => {
    it("returns path inside .claude/commands/", () => {
      const p = grounderNoteCommandPath("/home/user");
      expect(p).toBe("/home/user/.claude/commands/grounder-note.md");
    });
  });

  describe("claude.install", () => {
    it("creates the command file and returns created", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const result = await claude.install({ homeDir: env.home });
      const dest = grounderNoteCommandPath(env.home);

      expect(result.artifacts[dest]).toBe("created");
      await access(dest);
      expect(await readFile(dest, "utf8")).toContain("npx grounder note");
    });

    it("skips if already exists and force is false", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await claude.install({ homeDir: env.home });
      const result = await claude.install({ homeDir: env.home });
      const dest = grounderNoteCommandPath(env.home);

      expect(result.artifacts[dest]).toBe("skipped");
    });

    it("overwrites if force is true", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await claude.install({ homeDir: env.home });
      const result = await claude.install({ homeDir: env.home, force: true });
      const dest = grounderNoteCommandPath(env.home);

      expect(result.artifacts[dest]).toBe("overwritten");
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
