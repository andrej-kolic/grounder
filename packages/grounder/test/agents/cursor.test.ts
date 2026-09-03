import { describe, expect, it } from "vitest";
import {
  cursor,
  grounderNoteCommandPath,
  grounderPlanCommandPath,
  grounderTaskCommandPath,
  grounderTaskHandoffCommandPath,
} from "../../src/agents/cursor.js";
import { runtimeInvocation } from "../../src/agents/hook-runtime.js";

describe("agents/cursor", () => {
  describe("command paths", () => {
    it("returns paths inside .cursor/skills/", () => {
      expect(grounderNoteCommandPath("/home/user")).toBe(
        "/home/user/.cursor/skills/grounder-note/SKILL.md",
      );
      expect(grounderPlanCommandPath("/home/user")).toBe(
        "/home/user/.cursor/skills/grounder-plan/SKILL.md",
      );
      expect(grounderTaskHandoffCommandPath("/home/user")).toBe(
        "/home/user/.cursor/skills/grounder-task-handoff/SKILL.md",
      );
      expect(grounderTaskCommandPath("/home/user")).toBe(
        "/home/user/.cursor/skills/grounder-task/SKILL.md",
      );
    });
  });

  describe("cursor.expectedArtifacts", () => {
    it("lists the same paths desiredArtifacts renders", async () => {
      expect(cursor.expectedArtifacts("/home/user")).toEqual([
        "/home/user/.cursor/skills/grounder-note/SKILL.md",
        "/home/user/.cursor/skills/grounder-search/SKILL.md",
        "/home/user/.cursor/skills/grounder-plan/SKILL.md",
        "/home/user/.cursor/skills/grounder-task-handoff/SKILL.md",
        "/home/user/.cursor/skills/grounder-task/SKILL.md",
      ]);
      const desired = await cursor.desiredArtifacts("/home/user");
      expect(Object.keys(desired).sort()).toEqual(cursor.expectedArtifacts("/home/user").sort());
    });
  });

  describe("cursor.desiredArtifacts", () => {
    it("renders the runtime invocation into each skill file, no leftover placeholder", async () => {
      const desired = await cursor.desiredArtifacts("/home/user");
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

  describe("cursor.tombstones", () => {
    it("lists the frozen schema-3 pre-skill command paths", () => {
      expect(cursor.tombstones("/home/user")).toEqual([
        "/home/user/.cursor/commands/grounder-note.md",
        "/home/user/.cursor/commands/grounder-search.md",
        "/home/user/.cursor/commands/grounder-plan.md",
        "/home/user/.cursor/commands/grounder-task-handoff.md",
        "/home/user/.cursor/commands/grounder-task.md",
      ]);
    });
  });

  describe("cursor.isInstalled", () => {
    it("returns false when .cursor dir does not exist", async () => {
      const { mkdtemp, rm } = await import("node:fs/promises");
      const os = await import("node:os");
      const path = await import("node:path");
      const base = await mkdtemp(path.join(os.tmpdir(), "grounder-cursor-test-"));
      const prev = process.env.GROUNDER_HOME;
      process.env.GROUNDER_HOME = base;
      try {
        expect(await cursor.isInstalled()).toBe(false);
      } finally {
        if (prev === undefined) delete process.env.GROUNDER_HOME;
        else process.env.GROUNDER_HOME = prev;
        await rm(base, { recursive: true, force: true });
      }
    });
  });
});
