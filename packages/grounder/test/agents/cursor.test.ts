import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cursor,
  grounderNoteCommandPath,
  grounderPlanCommandPath,
  grounderTaskCommandPath,
  grounderTaskHandoffCommandPath,
} from "../../src/agents/cursor.js";
import { runtimeInvocation } from "../../src/agents/hook-runtime.js";
import { createTempEnv } from "../helpers.js";

describe("agents/cursor", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

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
    it("lists the same command paths install writes", () => {
      expect(cursor.expectedArtifacts("/home/user")).toEqual([
        "/home/user/.cursor/skills/grounder-note/SKILL.md",
        "/home/user/.cursor/skills/grounder-search/SKILL.md",
        "/home/user/.cursor/skills/grounder-plan/SKILL.md",
        "/home/user/.cursor/skills/grounder-task-handoff/SKILL.md",
        "/home/user/.cursor/skills/grounder-task/SKILL.md",
      ]);
    });

    it("matches keys produced by install", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const result = await cursor.install({ homeDir: env.home });
      expect(Object.keys(result.artifacts).sort()).toEqual(
        cursor.expectedArtifacts(env.home).sort(),
      );
    });
  });

  describe("cursor.install", () => {
    it("creates note, plan, handoff, and task skill files", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const result = await cursor.install({ homeDir: env.home });
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

      const result = await cursor.install({ homeDir: env.home });
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

      await cursor.install({ homeDir: env.home });
      const result = await cursor.install({ homeDir: env.home });
      const noteDest = grounderNoteCommandPath(env.home);
      const planDest = grounderPlanCommandPath(env.home);
      const handoffDest = grounderTaskHandoffCommandPath(env.home);
      const taskDest = grounderTaskCommandPath(env.home);

      expect(result.artifacts[noteDest]).toBe("skipped");
      expect(result.artifacts[planDest]).toBe("skipped");
      expect(result.artifacts[handoffDest]).toBe("skipped");
      expect(result.artifacts[taskDest]).toBe("skipped");
    });

    it("auto-updates untouched files when the template would change", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await cursor.install({ homeDir: env.home });
      const noteDest = grounderNoteCommandPath(env.home);
      const original = await readFile(noteDest, "utf8");
      // Simulate an older Grounder write: same ledger hash, different on-disk
      // content would be "modified"; instead keep content matching the ledger
      // and change the would-be render by rewriting the file to a prior version
      // then restoring the recorded hash via a content-preserving edit path:
      // write a different body, update ledger hash to match, then install with
      // a force-free run after putting the "old" content that still matches ledger.
      const staleBody = `${original}\n<!-- stale -->\n`;
      await writeFile(noteDest, staleBody, "utf8");
      const { readGrounderState, writeGrounderState } = await import(
        "../../src/connector/state.js"
      );
      const { hashContent } = await import("../../src/util/hash.js");
      const state = await readGrounderState(env.home);
      if (!state?.agents.cursor) {
        throw new Error("expected cursor state after install");
      }
      state.agents.cursor.files[noteDest] = {
        hash: hashContent(staleBody),
      };
      await writeGrounderState(state, env.home);

      const result = await cursor.install({ homeDir: env.home });
      expect(result.artifacts[noteDest]).toBe("overwritten");
      expect(await readFile(noteDest, "utf8")).toBe(original);
    });

    it("does not overwrite locally modified files without force", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await cursor.install({ homeDir: env.home });
      const noteDest = grounderNoteCommandPath(env.home);
      await writeFile(noteDest, "my custom edits\n", "utf8");

      const result = await cursor.install({ homeDir: env.home });
      expect(result.artifacts[noteDest]).toBe("modified");
      expect(await readFile(noteDest, "utf8")).toBe("my custom edits\n");
    });

    it("overwrites locally modified files if force is true, leaving unchanged ones alone", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      await cursor.install({ homeDir: env.home });
      const noteDest = grounderNoteCommandPath(env.home);
      await writeFile(noteDest, "my custom edits\n", "utf8");
      const result = await cursor.install({ homeDir: env.home, force: true });
      const planDest = grounderPlanCommandPath(env.home);
      const handoffDest = grounderTaskHandoffCommandPath(env.home);
      const taskDest = grounderTaskCommandPath(env.home);

      // Only the file that actually differs from the template gets rewritten —
      // force overrides the "protect local edits" guard, not the "already
      // matches the template" check.
      expect(result.artifacts[noteDest]).toBe("overwritten");
      expect(result.artifacts[planDest]).toBe("skipped");
      expect(result.artifacts[handoffDest]).toBe("skipped");
      expect(result.artifacts[taskDest]).toBe("skipped");
      expect(await readFile(noteDest, "utf8")).toContain(runtimeInvocation(env.home));
    });
  });

  describe("cursor.isInstalled", () => {
    it("returns false when .cursor dir does not exist", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      // Override GROUNDER_HOME so resolveHomeDir() points to env.home (no .cursor there)
      const prev = process.env.GROUNDER_HOME;
      process.env.GROUNDER_HOME = env.home;
      try {
        expect(await cursor.isInstalled()).toBe(false);
      } finally {
        if (prev === undefined) delete process.env.GROUNDER_HOME;
        else process.env.GROUNDER_HOME = prev;
      }
    });
  });
});
