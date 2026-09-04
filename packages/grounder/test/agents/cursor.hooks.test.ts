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
import { fileExists } from "../../src/util/fs.js";
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

    it("reports already-current under force as skipped, not overwritten", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = cursorHooksJsonPath(env.home);
      await cursor.installHooks?.({ homeDir: env.home });
      const before = await readFile(dest, "utf8");

      const result = await cursor.installHooks?.({ homeDir: env.home, force: true });

      expect(result?.artifacts[dest]).toBe("skipped");
      expect(await readFile(dest, "utf8")).toBe(before);
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

    it("replaces a runtime command missing --json in place (no duplicate)", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = cursorHooksJsonPath(env.home);
      // Install once so the runtime exists, then rewrite hooks without --json.
      await cursor.installHooks?.({ homeDir: env.home });
      const withoutJson = cursorPeekHookCommand(env.home, []);
      expect(withoutJson).not.toContain("--json");
      await writeFile(
        dest,
        `${JSON.stringify(
          {
            version: 1,
            hooks: {
              sessionStart: [{ command: withoutJson }],
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
      expect(written.hooks.sessionStart).toHaveLength(1);
      expect(cursorPeekHookCommand(env.home)).toContain("--json");
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

    it("backs off without clobbering a hooks.json whose hooks key is not an object", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = cursorHooksJsonPath(env.home);
      // Valid JSON, but `hooks` is unmergeable. Grounder must refuse rather
      // than replace it with its own object — the whole point of merging into
      // a shared hooks file is that unrelated content survives.
      const original = `${JSON.stringify({ version: 1, hooks: ["not-an-event-map"] }, null, 2)}\n`;
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, original);

      await expect(cursor.installHooks?.({ homeDir: env.home })).rejects.toThrow(
        /"hooks" must be a JSON object/,
      );
      expect(await readFile(dest, "utf8")).toBe(original);
    });

    it("dedupes a legacy npx entry and a drifted runtime entry into exactly one canonical entry", async () => {
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
              sessionStart: [
                { command: "npx grounder handoff peek --json" },
                { command: cursorPeekHookCommand(env.home, []) },
                { command: "echo unrelated" },
              ],
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
      const commands = written.hooks.sessionStart.map((h) => h.command);
      expect(commands.filter((c) => c === cursorPeekHookCommand(env.home))).toHaveLength(1);
      expect(commands).toContain("echo unrelated");
      expect(commands).toHaveLength(2);
    });
  });

  describe("removeHooks", () => {
    it("removes the Grounder entry and nothing else", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = cursorHooksJsonPath(env.home);
      await cursor.installHooks?.({ homeDir: env.home });

      const result = await cursor.removeHooks?.({ homeDir: env.home });
      expect(result?.artifacts[dest]).toBe("overwritten");
      expect(JSON.parse(await readFile(dest, "utf8"))).toEqual({
        version: 1,
        hooks: { sessionStart: [] },
      });
    });

    it("is a no-op when the file does not exist", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const result = await cursor.removeHooks?.({ homeDir: env.home });
      expect(result?.artifacts).toEqual({});
      expect(await fileExists(cursorHooksJsonPath(env.home))).toBe(false);
    });

    it("leaves a hooks.json whose hooks key is not an object untouched", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = cursorHooksJsonPath(env.home);
      const original = `${JSON.stringify({ version: 1, hooks: ["not-an-event-map"] }, null, 2)}\n`;
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, original);

      // The mirror of installHooks' refusal: an unmergeable `hooks` can't hold
      // a Grounder entry, so removal has nothing to do and reports nothing —
      // it must not restructure the key on its way to that conclusion.
      const result = await cursor.removeHooks?.({ homeDir: env.home });
      expect(result?.artifacts).toEqual({});
      expect(await readFile(dest, "utf8")).toBe(original);
    });

    it("leaves an existing hooks.json byte-for-byte untouched when there's no Grounder entry to remove", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = cursorHooksJsonPath(env.home);
      await mkdir(path.dirname(dest), { recursive: true });
      const original = `${JSON.stringify(
        { version: 1, hooks: { beforeSubmitPrompt: [{ command: "echo other" }] } },
        null,
        2,
      )}\n`;
      await writeFile(dest, original);

      const result = await cursor.removeHooks?.({ homeDir: env.home });

      expect(result?.artifacts).toEqual({});
      expect(await readFile(dest, "utf8")).toBe(original);
    });

    it("preserves unrelated sessionStart hooks", async () => {
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
              sessionStart: [
                { command: cursorPeekHookCommand(env.home) },
                { command: "echo keep-me" },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      await cursor.removeHooks?.({ homeDir: env.home });

      expect(JSON.parse(await readFile(dest, "utf8"))).toEqual({
        version: 1,
        hooks: { sessionStart: [{ command: "echo keep-me" }] },
      });
    });
  });
});
