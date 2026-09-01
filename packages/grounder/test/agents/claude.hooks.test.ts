import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLAUDE_SESSION_START_MATCHER,
  claude,
  claudePeekHookCommand,
  claudeSettingsJsonPath,
  claudeStatuslineCommand,
  expectedHookArtifacts,
} from "../../src/agents/claude.js";
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
        statusLine: { type: "command", command: claudeStatuslineCommand(env.home) },
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
        statusLine: { type: "command", command: claudeStatuslineCommand(env.home) },
      });
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
        statusLine: { type: "command", command: claudeStatuslineCommand(env.home) },
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
        statusLine: { type: "command", command: claudeStatuslineCommand(env.home) },
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
        statusLine: { type: "command", command: claudeStatuslineCommand(env.home) },
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
        statusLine: { command: string };
      };
      expect(written.hooks.SessionStart).toHaveLength(1);
      expect(written.hooks.SessionStart[0]?.hooks).toEqual([
        { type: "command", command: claudePeekHookCommand(env.home) },
      ]);
      expect(written.statusLine.command).toBe(claudeStatuslineCommand(env.home));
    });

    it("leaves a foreign statusLine untouched without force", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(
        dest,
        `${JSON.stringify(
          { statusLine: { type: "command", command: "~/.claude/my-custom-statusline.sh" } },
          null,
          2,
        )}\n`,
      );

      const result = await claude.installHooks?.({ homeDir: env.home });

      expect(result?.artifacts[dest]).toBe("created");
      const written = JSON.parse(await readFile(dest, "utf8")) as {
        statusLine: { command: string };
      };
      expect(written.statusLine.command).toBe("~/.claude/my-custom-statusline.sh");
    });

    it("replaces a foreign statusLine when force is true", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(
        dest,
        `${JSON.stringify(
          { statusLine: { type: "command", command: "~/.claude/my-custom-statusline.sh" } },
          null,
          2,
        )}\n`,
      );

      const result = await claude.installHooks?.({ homeDir: env.home, force: true });

      // "created", not "overwritten": the label reflects whether Grounder's own
      // hook entry pre-existed (it didn't) — same as any other file that already
      // had unrelated content before Grounder's first write to it.
      expect(result?.artifacts[dest]).toBe("created");
      const written = JSON.parse(await readFile(dest, "utf8")) as {
        statusLine: { command: string };
      };
      expect(written.statusLine.command).toBe(claudeStatuslineCommand(env.home));
    });

    it("refreshes a stale statusLine command in place without force", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      await claude.installHooks?.({ homeDir: env.home });
      await writeFile(
        dest,
        JSON.stringify({
          ...JSON.parse(await readFile(dest, "utf8")),
          statusLine: {
            type: "command",
            command: `${claudeStatuslineCommand(env.home)} --stale`,
          },
        }),
      );

      const result = await claude.installHooks?.({ homeDir: env.home });

      expect(result?.artifacts[dest]).toBe("overwritten");
      const written = JSON.parse(await readFile(dest, "utf8")) as {
        statusLine: { command: string };
      };
      expect(written.statusLine.command).toBe(claudeStatuslineCommand(env.home));
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
  });
});
