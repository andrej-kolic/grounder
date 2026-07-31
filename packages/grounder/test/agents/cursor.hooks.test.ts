import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cursor,
  cursorHooksJsonPath,
  cursorPeekHookCommand,
  expectedHookArtifacts,
} from "../../src/agents/cursor.js";
import { runtimeCliPath } from "../../src/agents/hook-runtime.js";
import { createTempEnv } from "../helpers.js";

describe("agents/cursor hooks", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  describe("expectedHookArtifacts", () => {
    it("returns ~/.cursor/hooks.json", () => {
      expect(expectedHookArtifacts("/home/user")).toEqual(["/home/user/.cursor/hooks.json"]);
      expect(cursor.expectedHookArtifacts?.("/home/user")).toEqual([
        "/home/user/.cursor/hooks.json",
      ]);
    });

    it("matches keys produced by installHooks", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const result = await cursor.installHooks?.({ homeDir: env.home });
      expect(result).toBeDefined();
      expect(Object.keys(result?.artifacts ?? {}).sort()).toEqual(
        expectedHookArtifacts(env.home).sort(),
      );
    });
  });

  describe("installHooks", () => {
    it("creates a fresh hooks.json with sessionStart entry pointing at the home runtime", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = cursorHooksJsonPath(env.home);
      const result = await cursor.installHooks?.({ homeDir: env.home });

      expect(result?.artifacts[dest]).toBe("created");
      expect(JSON.parse(await readFile(dest, "utf8"))).toEqual({
        version: 1,
        hooks: {
          sessionStart: [{ command: cursorPeekHookCommand(env.home) }],
        },
      });
      expect(await readFile(runtimeCliPath(env.home), "utf8")).toContain("handoff");
    });

    it("skips when Grounder entry already exists, runtime is fresh, and force is false", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = cursorHooksJsonPath(env.home);
      await cursor.installHooks?.({ homeDir: env.home });
      const first = await readFile(dest, "utf8");

      const result = await cursor.installHooks?.({ homeDir: env.home });

      expect(result?.artifacts[dest]).toBe("skipped");
      expect(await readFile(dest, "utf8")).toBe(first);
    });

    it("overwrites Grounder entry when force is true", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = cursorHooksJsonPath(env.home);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(
        dest,
        `${JSON.stringify(
          {
            version: 1,
            hooks: {
              sessionStart: [{ command: cursorPeekHookCommand(env.home), stale: true }],
            },
          },
          null,
          2,
        )}\n`,
      );

      const result = await cursor.installHooks?.({ homeDir: env.home, force: true });

      expect(result?.artifacts[dest]).toBe("overwritten");
      const written = JSON.parse(await readFile(dest, "utf8")) as {
        hooks: { sessionStart: unknown[] };
      };
      expect(written.hooks.sessionStart).toHaveLength(1);
      expect(written.hooks.sessionStart[0]).toEqual({ command: cursorPeekHookCommand(env.home) });
    });

    it("migrates a legacy npx command without requiring force", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = cursorHooksJsonPath(env.home);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(
        dest,
        `${JSON.stringify(
          {
            version: 1,
            hooks: {
              sessionStart: [{ command: "npx grounder handoff peek" }],
            },
          },
          null,
          2,
        )}\n`,
      );

      const result = await cursor.installHooks?.({ homeDir: env.home });

      expect(result?.artifacts[dest]).toBe("overwritten");
      const written = JSON.parse(await readFile(dest, "utf8")) as {
        hooks: { sessionStart: Array<{ command: string }> };
      };
      expect(written.hooks.sessionStart).toEqual([{ command: cursorPeekHookCommand(env.home) }]);
    });

    it("preserves unrelated hooks and top-level keys", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = cursorHooksJsonPath(env.home);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(
        dest,
        `${JSON.stringify(
          {
            version: 1,
            hooks: {
              beforeSubmitPrompt: [{ command: "echo other" }],
            },
            theme: "dark",
          },
          null,
          2,
        )}\n`,
      );

      const result = await cursor.installHooks?.({ homeDir: env.home });

      expect(result?.artifacts[dest]).toBe("created");
      expect(JSON.parse(await readFile(dest, "utf8"))).toEqual({
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ command: "echo other" }],
          sessionStart: [{ command: cursorPeekHookCommand(env.home) }],
        },
        theme: "dark",
      });
    });

    it("re-install is idempotent (no duplicate entries)", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = cursorHooksJsonPath(env.home);
      await cursor.installHooks?.({ homeDir: env.home });
      await cursor.installHooks?.({ homeDir: env.home, force: true });
      await cursor.installHooks?.({ homeDir: env.home });

      const written = JSON.parse(await readFile(dest, "utf8")) as {
        hooks: { sessionStart: unknown[] };
      };
      expect(written.hooks.sessionStart).toEqual([{ command: cursorPeekHookCommand(env.home) }]);
    });

    it("backs off without clobbering malformed hooks.json", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = cursorHooksJsonPath(env.home);
      const original = "{ not valid json\n";
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, original);

      await expect(cursor.installHooks?.({ homeDir: env.home })).rejects.toThrow(/invalid JSON/i);
      expect(await readFile(dest, "utf8")).toBe(original);
    });
  });
});
