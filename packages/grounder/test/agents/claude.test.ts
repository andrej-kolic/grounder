import { describe, expect, it } from "vitest";
import {
  claude,
  grounderNoteCommandPath,
  grounderPlanCommandPath,
  grounderTaskCommandPath,
  grounderTaskHandoffCommandPath,
} from "../../src/agents/claude.js";
import { runtimeInvocation } from "../../src/agents/hook-runtime.js";

describe("agents/claude", () => {
  describe("command paths", () => {
    it("returns paths inside .claude/skills/", () => {
      expect(grounderNoteCommandPath("/home/user")).toBe(
        "/home/user/.claude/skills/grounder-note/SKILL.md",
      );
      expect(grounderPlanCommandPath("/home/user")).toBe(
        "/home/user/.claude/skills/grounder-plan/SKILL.md",
      );
      expect(grounderTaskHandoffCommandPath("/home/user")).toBe(
        "/home/user/.claude/skills/grounder-task-handoff/SKILL.md",
      );
      expect(grounderTaskCommandPath("/home/user")).toBe(
        "/home/user/.claude/skills/grounder-task/SKILL.md",
      );
    });
  });

  describe("claude.expectedArtifacts", () => {
    it("lists the same paths desiredArtifacts renders", async () => {
      expect(claude.expectedArtifacts("/home/user")).toEqual([
        "/home/user/.claude/skills/grounder-note/SKILL.md",
        "/home/user/.claude/skills/grounder-search/SKILL.md",
        "/home/user/.claude/skills/grounder-plan/SKILL.md",
        "/home/user/.claude/skills/grounder-task-handoff/SKILL.md",
        "/home/user/.claude/skills/grounder-task/SKILL.md",
      ]);
      const desired = await claude.desiredArtifacts("/home/user");
      expect(Object.keys(desired).sort()).toEqual(claude.expectedArtifacts("/home/user").sort());
    });
  });

  describe("claude.desiredArtifacts", () => {
    it("renders the runtime invocation into each skill file, no leftover placeholder", async () => {
      const desired = await claude.desiredArtifacts("/home/user");
      const cli = runtimeInvocation("/home/user");
      const noteDest = grounderNoteCommandPath("/home/user");
      const planDest = grounderPlanCommandPath("/home/user");
      const handoffDest = grounderTaskHandoffCommandPath("/home/user");
      const taskDest = grounderTaskCommandPath("/home/user");

      expect(desired[noteDest]).toContain(`${cli} note`);
      expect(desired[planDest]).toContain(`${cli} plan`);
      expect(desired[handoffDest]).toContain(`${cli} handoff`);
      expect(desired[taskDest]).toContain(`${cli} handoff list`);
      expect(desired[noteDest]).not.toContain("npx");
      expect(desired[noteDest]).not.toContain("{{GROUNDER_CLI}}");
    });
  });

  describe("claude.tombstones", () => {
    it("lists the frozen schema-3 pre-skill command paths", () => {
      expect(claude.tombstones("/home/user")).toEqual([
        "/home/user/.claude/commands/grounder-note.md",
        "/home/user/.claude/commands/grounder-search.md",
        "/home/user/.claude/commands/grounder-plan.md",
        "/home/user/.claude/commands/grounder-task-handoff.md",
        "/home/user/.claude/commands/grounder-task.md",
      ]);
    });
  });

  describe("claude.isInstalled", () => {
    it("returns false when .claude dir does not exist", async () => {
      const { mkdtemp } = await import("node:fs/promises");
      const os = await import("node:os");
      const path = await import("node:path");
      const base = await mkdtemp(path.join(os.tmpdir(), "grounder-claude-test-"));
      const prev = process.env.GROUNDER_HOME;
      process.env.GROUNDER_HOME = base;
      try {
        expect(await claude.isInstalled()).toBe(false);
      } finally {
        if (prev === undefined) delete process.env.GROUNDER_HOME;
        else process.env.GROUNDER_HOME = prev;
        const { rm } = await import("node:fs/promises");
        await rm(base, { recursive: true, force: true });
      }
    });
  });
});
