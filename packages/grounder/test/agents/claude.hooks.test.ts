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

    it("does not treat a non-command hook entry with a matching command string as Grounder's own", async () => {
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
                  hooks: [{ type: "other", command: claudePeekHookCommand(env.home) }],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      const result = await claude.installHooks?.({ homeDir: env.home });

      // A non-`command` hook is not Grounder's, even if its `command` string
      // happens to match — it must survive untouched, alongside Grounder's
      // own newly appended entry. Not recognized as a prior Grounder entry,
      // so this reports "created" (matches the "preserves unrelated hooks"
      // case above), not "overwritten".
      expect(result?.artifacts[dest]).toBe("created");
      expect(JSON.parse(await readFile(dest, "utf8"))).toEqual({
        hooks: {
          SessionStart: [
            {
              matcher: CLAUDE_SESSION_START_MATCHER,
              hooks: [
                { type: "other", command: claudePeekHookCommand(env.home) },
                { type: "command", command: claudePeekHookCommand(env.home) },
              ],
            },
          ],
        },
      });
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

    it("backs off without clobbering a settings.json whose hooks key is not an object", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      // Valid JSON, but `hooks` is unmergeable. Grounder must refuse rather
      // than replace it with its own object — the whole point of merging into
      // a shared settings file is that unrelated content survives.
      const original = `${JSON.stringify(
        { hooks: ["not-a-matcher-group"], permissions: { allow: ["Bash"] } },
        null,
        2,
      )}\n`;
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, original);

      await expect(claude.installHooks?.({ homeDir: env.home })).rejects.toThrow(
        /"hooks" must be a JSON object/,
      );
      expect(await readFile(dest, "utf8")).toBe(original);
    });

    it("converges a byte-identical canonical entry sitting under the wrong matcher group instead of reporting it as already up to date", async () => {
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
                  matcher: "*",
                  hooks: [{ type: "command", command: claudePeekHookCommand(env.home) }],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      const result = await claude.installHooks?.({ homeDir: env.home });

      // Not "skipped": the entry's bytes matched but it lived under the wrong
      // matcher, so this must still converge it into the canonical group —
      // and not leave the now-empty "*" group behind.
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
      // The matcher group Grounder itself created is dropped once its own
      // removal leaves its `hooks` array empty — not left behind as clutter.
      expect(JSON.parse(await readFile(dest, "utf8"))).toEqual({
        hooks: { SessionStart: [] },
      });
    });

    it("is a no-op when the file does not exist", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const missing = await claude.removeHooks?.({ homeDir: env.home });
      expect(missing?.artifacts).toEqual({});
      expect(await fileExists(claudeSettingsJsonPath(env.home))).toBe(false);
    });

    it("leaves a settings.json whose hooks key is not an object untouched", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      const original = `${JSON.stringify({ hooks: ["not-a-matcher-group"] }, null, 2)}\n`;
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, original);

      // The mirror of installHooks' refusal: an unmergeable `hooks` can't hold
      // a Grounder entry, so removal has nothing to do and reports nothing —
      // it must not restructure the key on its way to that conclusion.
      const result = await claude.removeHooks?.({ homeDir: env.home });
      expect(result?.artifacts).toEqual({});
      expect(await readFile(dest, "utf8")).toBe(original);
    });

    it("leaves an existing settings.json byte-for-byte untouched when there's no Grounder entry to remove", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const dest = claudeSettingsJsonPath(env.home);
      await mkdir(path.dirname(dest), { recursive: true });
      const original = `${JSON.stringify(
        {
          hooks: {
            SessionStart: [
              { matcher: "otherEvent", hooks: [{ type: "command", command: "echo other" }] },
            ],
          },
        },
        null,
        2,
      )}\n`;
      await writeFile(dest, original);

      const result = await claude.removeHooks?.({ homeDir: env.home });

      expect(result?.artifacts).toEqual({});
      expect(await readFile(dest, "utf8")).toBe(original);
    });

    it("drops a matcher group left empty by removal without touching groups that still have other hooks", async () => {
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
                  hooks: [{ type: "command", command: claudePeekHookCommand(env.home) }],
                },
                {
                  matcher: "otherEvent",
                  hooks: [{ type: "command", command: "echo keep-me" }],
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
            { matcher: "otherEvent", hooks: [{ type: "command", command: "echo keep-me" }] },
          ],
        },
      });
    });

    it("leaves a matcher group already empty for unrelated reasons in place", async () => {
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
                  hooks: [{ type: "command", command: claudePeekHookCommand(env.home) }],
                },
                { matcher: "otherEvent", hooks: [] },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      await claude.removeHooks?.({ homeDir: env.home });

      // Grounder's own group is emptied by this removal and dropped; the
      // "otherEvent" group was already empty before Grounder touched
      // anything — not Grounder's clutter to clean up, so it survives.
      expect(JSON.parse(await readFile(dest, "utf8"))).toEqual({
        hooks: {
          SessionStart: [{ matcher: "otherEvent", hooks: [] }],
        },
      });
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
