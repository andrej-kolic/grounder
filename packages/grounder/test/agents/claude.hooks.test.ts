import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLAUDE_SESSION_START_MATCHER,
  claude,
  claudePeekHookCommand,
  claudeSettingsJsonPath,
  expectedHookArtifacts,
} from "../../src/agents/claude.js";
import { fileExists } from "../../src/util/fs.js";
import { createTempEnv } from "../helpers.js";

describe("agents/claude hooks", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  describe("expectedHookArtifacts", () => {
    it("returns ~/.claude/settings.json", () => {
      expect(expectedHookArtifacts("/home/user")).toEqual(["/home/user/.claude/settings.json"]);
      expect(claude.expectedHookArtifacts?.("/home/user")).toEqual([
        "/home/user/.claude/settings.json",
      ]);
    });

    it("matches keys produced by installHooks", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const result = await claude.installHooks?.({ homeDir: env.home });
      expect(result).toBeDefined();
      expect(Object.keys(result?.artifacts ?? {}).sort()).toEqual(
        expectedHookArtifacts(env.home).sort(),
      );
    });
  });

  describe("installHooks", () => {
    it("creates a fresh settings.json with SessionStart entry pointing at the home runtime", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      const result = await claude.installHooks?.({ homeDir: env.home });

      expect(result?.artifacts[dest]).toBe("created");
      expect(JSON.parse(await readFile(dest, "utf8"))).toEqual({
        hooks: {
          SessionStart: [
            {
              matcher: CLAUDE_SESSION_START_MATCHER,
              hooks: [{ type: "command", command: claudePeekHookCommand(env.home) }],
            },
          ],
        },
      });
    });

    it("skips when Grounder entry already exists, runtime is fresh, and force is false", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      await claude.installHooks?.({ homeDir: env.home });
      const first = await readFile(dest, "utf8");

      const result = await claude.installHooks?.({ homeDir: env.home });

      expect(result?.artifacts[dest]).toBe("skipped");
      expect(await readFile(dest, "utf8")).toBe(first);
    });

    it("overwrites Grounder entry when force is true", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(
        dest,
        `${JSON.stringify(
          {
            hooks: {
              SessionStart: [
                {
                  matcher: CLAUDE_SESSION_START_MATCHER,
                  hooks: [
                    {
                      type: "command",
                      command: claudePeekHookCommand(env.home),
                      stale: true,
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      const result = await claude.installHooks?.({ homeDir: env.home, force: true });

      expect(result?.artifacts[dest]).toBe("overwritten");
      expect(JSON.parse(await readFile(dest, "utf8"))).toEqual({
        hooks: {
          SessionStart: [
            {
              matcher: CLAUDE_SESSION_START_MATCHER,
              hooks: [{ type: "command", command: claudePeekHookCommand(env.home) }],
            },
          ],
        },
      });
    });

    it("reports already-current under force as skipped, not overwritten", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      await claude.installHooks?.({ homeDir: env.home });
      const before = await readFile(dest, "utf8");

      const result = await claude.installHooks?.({ homeDir: env.home, force: true });

      expect(result?.artifacts[dest]).toBe("skipped");
      expect(await readFile(dest, "utf8")).toBe(before);
    });

    it("migrates a legacy npx command without requiring force", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(
        dest,
        `${JSON.stringify(
          {
            hooks: {
              SessionStart: [
                {
                  matcher: CLAUDE_SESSION_START_MATCHER,
                  hooks: [{ type: "command", command: "npx grounder handoff peek" }],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      const result = await claude.installHooks?.({ homeDir: env.home });

      expect(result?.artifacts[dest]).toBe("overwritten");
      expect(JSON.parse(await readFile(dest, "utf8"))).toEqual({
        hooks: {
          SessionStart: [
            {
              matcher: CLAUDE_SESSION_START_MATCHER,
              hooks: [{ type: "command", command: claudePeekHookCommand(env.home) }],
            },
          ],
        },
      });
    });

    it("preserves unrelated hooks and top-level keys", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(
        dest,
        `${JSON.stringify(
          {
            permissions: { allow: ["Bash"] },
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [{ type: "command", command: "echo audit" }],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      const result = await claude.installHooks?.({ homeDir: env.home });

      expect(result?.artifacts[dest]).toBe("created");
      expect(JSON.parse(await readFile(dest, "utf8"))).toEqual({
        permissions: { allow: ["Bash"] },
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "echo audit" }],
            },
          ],
          SessionStart: [
            {
              matcher: CLAUDE_SESSION_START_MATCHER,
              hooks: [{ type: "command", command: claudePeekHookCommand(env.home) }],
            },
          ],
        },
      });
    });

    it("appends into an existing SessionStart matcher group", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(
        dest,
        `${JSON.stringify(
          {
            hooks: {
              SessionStart: [
                {
                  matcher: CLAUDE_SESSION_START_MATCHER,
                  hooks: [{ type: "command", command: "echo other-startup" }],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      const result = await claude.installHooks?.({ homeDir: env.home });

      expect(result?.artifacts[dest]).toBe("created");
      expect(JSON.parse(await readFile(dest, "utf8"))).toEqual({
        hooks: {
          SessionStart: [
            {
              matcher: CLAUDE_SESSION_START_MATCHER,
              hooks: [
                { type: "command", command: "echo other-startup" },
                { type: "command", command: claudePeekHookCommand(env.home) },
              ],
            },
          ],
        },
      });
    });

    it("re-install is idempotent (no duplicate entries)", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      await claude.installHooks?.({ homeDir: env.home });
      await claude.installHooks?.({ homeDir: env.home, force: true });
      await claude.installHooks?.({ homeDir: env.home });

      const written = JSON.parse(await readFile(dest, "utf8")) as {
        hooks: { SessionStart: Array<{ hooks: unknown[] }> };
      };
      expect(written.hooks.SessionStart).toHaveLength(1);
      expect(written.hooks.SessionStart[0]?.hooks).toEqual([
        { type: "command", command: claudePeekHookCommand(env.home) },
      ]);
    });

    it("backs off without clobbering malformed settings.json", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      const original = "{ not valid json\n";
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, original);

      await expect(claude.installHooks?.({ homeDir: env.home })).rejects.toThrow(/invalid JSON/i);
      expect(await readFile(dest, "utf8")).toBe(original);
    });

    it("dedupes a legacy npx entry and a runtime-form entry scattered across two matcher groups into exactly one canonical entry", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(
        dest,
        `${JSON.stringify(
          {
            hooks: {
              SessionStart: [
                {
                  matcher: CLAUDE_SESSION_START_MATCHER,
                  hooks: [{ type: "command", command: "npx grounder handoff peek" }],
                },
                {
                  matcher: "custom",
                  hooks: [
                    { type: "command", command: claudePeekHookCommand(env.home) },
                    { type: "command", command: "echo unrelated" },
                  ],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      const result = await claude.installHooks?.({ homeDir: env.home });

      expect(result?.artifacts[dest]).toBe("overwritten");
      const written = JSON.parse(await readFile(dest, "utf8")) as {
        hooks: { SessionStart: Array<{ matcher: string; hooks: Array<{ command: string }> }> };
      };
      const allCommands = written.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
      expect(allCommands.filter((c) => c === claudePeekHookCommand(env.home))).toHaveLength(1);
      // The unrelated hook in the "custom" group survives untouched.
      expect(allCommands).toContain("echo unrelated");
    });
  });

  describe("removeHooks", () => {
    it("removes the Grounder entry and nothing else", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      await claude.installHooks?.({ homeDir: env.home });

      const result = await claude.removeHooks?.({ homeDir: env.home });
      expect(result?.artifacts[dest]).toBe("overwritten");
      expect(JSON.parse(await readFile(dest, "utf8"))).toEqual({
        hooks: { SessionStart: [{ matcher: CLAUDE_SESSION_START_MATCHER, hooks: [] }] },
      });
    });

    it("is a no-op when the file does not exist, or when there is nothing to remove", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const missing = await claude.removeHooks?.({ homeDir: env.home });
      expect(missing?.artifacts).toEqual({});
      expect(await fileExists(claudeSettingsJsonPath(env.home))).toBe(false);
    });

    it("preserves unrelated hooks while removing every Grounder match", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(
        dest,
        `${JSON.stringify(
          {
            hooks: {
              SessionStart: [
                {
                  matcher: CLAUDE_SESSION_START_MATCHER,
                  hooks: [
                    { type: "command", command: claudePeekHookCommand(env.home) },
                    { type: "command", command: "echo keep-me" },
                  ],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      await claude.removeHooks?.({ homeDir: env.home });

      expect(JSON.parse(await readFile(dest, "utf8"))).toEqual({
        hooks: {
          SessionStart: [
            {
              matcher: CLAUDE_SESSION_START_MATCHER,
              hooks: [{ type: "command", command: "echo keep-me" }],
            },
          ],
        },
      });
    });
  });
});
