import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claude,
  grounderNoteCommandPath,
  grounderPlanCommandPath,
  grounderTaskCommandPath,
  grounderTaskHandoffCommandPath,
} from "../../src/agents/claude.js";
import { runtimeInvocation } from "../../src/agents/hook-runtime.js";
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
      expect(grounderPlanCommandPath("/home/user")).toBe(
        "/home/user/.claude/commands/grounder-plan.md",
      );
      expect(grounderTaskHandoffCommandPath("/home/user")).toBe(
        "/home/user/.claude/commands/grounder-task-handoff.md",
      );
      expect(grounderTaskCommandPath("/home/user")).toBe(
        "/home/user/.claude/commands/grounder-task.md",
      );
    });
  });

  describe("claude.expectedArtifacts", () => {
    it("lists the same command paths install writes", () => {
      expect(claude.expectedArtifacts("/home/user")).toEqual([
        "/home/user/.claude/commands/grounder-note.md",
        "/home/user/.claude/commands/grounder-plan.md",
        "/home/user/.claude/commands/grounder-task-handoff.md",
        "/home/user/.claude/commands/grounder-task.md",
      ]);
    });

    it("matches keys produced by install", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const result = await claude.install({ homeDir: env.home });
      expect(Object.keys(result.artifacts).sort()).toEqual(
        claude.expectedArtifacts(env.home).sort(),
      );
    });
  });

  describe("claude.install", () => {
    it("creates note, plan, handoff, and task command files", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const result = await claude.install({ homeDir: env.home });
      const noteDest = grounderNoteCommandPath(env.home);
      const planDest = grounderPlanCommandPath(env.home);
      const handoffDest = grounderTaskHandoffCommandPath(env.home);
      const taskDest = grounderTaskCommandPath(env.home);

      expect(result.artifacts[noteDest]).toBe("created");
      expect(result.artifacts[planDest]).toBe("created");
      expect(result.artifacts[handoffDest]).toBe("created");
      expect(result.artifacts[taskDest]).toBe("created");
      await access(noteDest);
      await access(planDest);
      await access(handoffDest);
      await access(taskDest);
      const cli = runtimeInvocation(env.home);
      expect(await readFile(noteDest, "utf8")).toContain(`${cli} note`);
      expect(await readFile(planDest, "utf8")).toContain(`${cli} plan`);
      expect(await readFile(handoffDest, "utf8")).toContain(`${cli} handoff`);
      expect(await readFile(taskDest, "utf8")).toContain(`${cli} handoff list`);
      expect(await readFile(noteDest, "utf8")).not.toContain("npx");
      expect(await readFile(noteDest, "utf8")).not.toContain("{{GROUNDER_CLI}}");
    });

    it("protects untracked/custom files and creates missing ones", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const noteDest = grounderNoteCommandPath(env.home);
      await mkdir(path.dirname(noteDest), { recursive: true });
      await writeFile(noteDest, "custom note command\n", "utf8");

      const result = await claude.install({ homeDir: env.home });
      const planDest = grounderPlanCommandPath(env.home);
      const handoffDest = grounderTaskHandoffCommandPath(env.home);
      const taskDest = grounderTaskCommandPath(env.home);

      expect(result.artifacts[noteDest]).toBe("modified");
      expect(result.artifacts[planDest]).toBe("created");
      expect(result.artifacts[handoffDest]).toBe("created");
      expect(result.artifacts[taskDest]).toBe("created");
      expect(await readFile(noteDest, "utf8")).toBe("custom note command\n");
      const cli = runtimeInvocation(env.home);
      expect(await readFile(planDest, "utf8")).toContain(`${cli} plan`);
      expect(await readFile(handoffDest, "utf8")).toContain(`${cli} handoff`);
      expect(await readFile(taskDest, "utf8")).toContain(`${cli} handoff list`);
    });

    it("skips when already current (hash matches, content unchanged)", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await claude.install({ homeDir: env.home });
      const result = await claude.install({ homeDir: env.home });
      const noteDest = grounderNoteCommandPath(env.home);
      const planDest = grounderPlanCommandPath(env.home);
      const handoffDest = grounderTaskHandoffCommandPath(env.home);
      const taskDest = grounderTaskCommandPath(env.home);

      expect(result.artifacts[noteDest]).toBe("skipped");
      expect(result.artifacts[planDest]).toBe("skipped");
      expect(result.artifacts[handoffDest]).toBe("skipped");
      expect(result.artifacts[taskDest]).toBe("skipped");
    });

    it("overwrites if force is true", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await claude.install({ homeDir: env.home });
      const result = await claude.install({ homeDir: env.home, force: true });
      const noteDest = grounderNoteCommandPath(env.home);
      const planDest = grounderPlanCommandPath(env.home);
      const handoffDest = grounderTaskHandoffCommandPath(env.home);
      const taskDest = grounderTaskCommandPath(env.home);

      expect(result.artifacts[noteDest]).toBe("overwritten");
      expect(result.artifacts[planDest]).toBe("overwritten");
      expect(result.artifacts[handoffDest]).toBe("overwritten");
      expect(result.artifacts[taskDest]).toBe("overwritten");
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
