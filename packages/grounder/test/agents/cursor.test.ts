import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cursor,
  grounderHandoffCommandPath,
  grounderNoteCommandPath,
  grounderPlanCommandPath,
  grounderRecallCommandPath,
} from "../../src/agents/cursor.js";
import { runtimeInvocation } from "../../src/agents/hook-runtime.js";
import { withHomeDir } from "../../src/connector/home.js";
import { createTempEnv } from "../helpers.js";

describe("agents/cursor", () => {
  describe("command paths", () => {
    it("returns paths inside .cursor/skills/", () => {
      expect(grounderNoteCommandPath("/home/user")).toBe(
        "/home/user/.cursor/skills/grounder-note/SKILL.md",
      );
      expect(grounderPlanCommandPath("/home/user")).toBe(
        "/home/user/.cursor/skills/grounder-plan/SKILL.md",
      );
      expect(grounderHandoffCommandPath("/home/user")).toBe(
        "/home/user/.cursor/skills/grounder-handoff/SKILL.md",
      );
      expect(grounderRecallCommandPath("/home/user")).toBe(
        "/home/user/.cursor/skills/grounder-recall/SKILL.md",
      );
    });
  });

  describe("cursor.expectedArtifacts", () => {
    it("lists the same paths desiredArtifacts renders", async () => {
      expect(cursor.expectedArtifacts("/home/user")).toEqual([
        "/home/user/.cursor/skills/grounder-note/SKILL.md",
        "/home/user/.cursor/skills/grounder-search/SKILL.md",
        "/home/user/.cursor/skills/grounder-overview/SKILL.md",
        "/home/user/.cursor/skills/grounder-plan/SKILL.md",
        "/home/user/.cursor/skills/grounder-handoff/SKILL.md",
        "/home/user/.cursor/skills/grounder-recall/SKILL.md",
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
      const handoffDest = grounderHandoffCommandPath("/home/user");
      const recallDest = grounderRecallCommandPath("/home/user");

      expect(desired[noteDest]).toContain(`${cli} note`);
      expect(desired[planDest]).toContain(`${cli} plan`);
      expect(desired[handoffDest]).toContain(`${cli} handoff`);
      expect(desired[recallDest]).toContain(`${cli} handoff list`);
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
      const env = await createTempEnv({ initGit: false });
      try {
        await withHomeDir(env.home, async () => {
          expect(await cursor.isInstalled()).toBe(false);
        });
      } finally {
        await env.cleanup();
      }
    });

    it("returns true when .cursor dir exists", async () => {
      const env = await createTempEnv({ initGit: false });
      try {
        await mkdir(path.join(env.home, ".cursor"), { recursive: true });
        await withHomeDir(env.home, async () => {
          expect(await cursor.isInstalled()).toBe(true);
        });
      } finally {
        await env.cleanup();
      }
    });
  });
});
