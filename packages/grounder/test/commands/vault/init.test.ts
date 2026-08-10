import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claude,
  claudePeekHookCommand,
  claudeSettingsJsonPath,
} from "../../../src/agents/claude.js";
import {
  cursor,
  cursorHooksJsonPath,
  cursorPeekHookCommand,
  grounderNoteCommandPath,
  grounderPlanCommandPath,
  grounderTaskHandoffCommandPath,
} from "../../../src/agents/cursor.js";
import { runtimeInvocation } from "../../../src/agents/hook-runtime.js";
import { runVaultInit, runVaultInitWithOptions } from "../../../src/commands/vault/init.js";
import { homeConfigPath } from "../../../src/connector/home.js";
import { readGrounderState, statePath } from "../../../src/connector/state.js";
import { VERSION } from "../../../src/index.js";
import { fileExists } from "../../../src/util/fs.js";
import { hashContent } from "../../../src/util/hash.js";
import { captureStdout, createTempEnv } from "../../helpers.js";

async function expectedFileLedger(
  paths: string[],
  schema = 1,
): Promise<Record<string, { schema: number; hash: string }>> {
  const files: Record<string, { schema: number; hash: string }> = {};
  for (const p of paths) {
    files[p] = { schema, hash: hashContent(await readFile(p, "utf8")) };
  }
  return files;
}

describe("commands/vault/init", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let previousGrounderHome: string | undefined;
  let restoredGrounderHome = false;

  afterEach(async () => {
    if (restoredGrounderHome) {
      if (previousGrounderHome === undefined) {
        delete process.env.GROUNDER_HOME;
      } else {
        process.env.GROUNDER_HOME = previousGrounderHome;
      }
      previousGrounderHome = undefined;
      restoredGrounderHome = false;
    }

    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("creates home config, vault scaffold, and cursor commands", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const { code, out } = await captureStdout(() =>
      runVaultInitWithOptions({
        vaultPath: env.vault,
        yes: true,
        homeDir: env.home,
        agents: ["cursor"],
      }),
    );

    expect(code).toBe(0);
    expect(out).toContain(`cursor   ${grounderNoteCommandPath(env.home)}`);
    expect(out).toContain(`cursor   ${grounderPlanCommandPath(env.home)}`);
    expect(out).toContain(`cursor   ${grounderTaskHandoffCommandPath(env.home)}`);
    expect(out).not.toContain("(Cursor artifacts)");
    expect(JSON.parse(await readFile(homeConfigPath(env.home), "utf8"))).toEqual({
      vaultRoot: env.vault,
    });
    await access(path.join(env.vault, "10-Projects"));
    const cli = runtimeInvocation(env.home);
    expect(await readFile(grounderNoteCommandPath(env.home), "utf8")).toContain(`${cli} note`);
    expect(await readFile(grounderNoteCommandPath(env.home), "utf8")).toContain(
      'required_permissions: ["all"]',
    );
    expect(await readFile(grounderTaskHandoffCommandPath(env.home), "utf8")).toContain(
      `${cli} handoff`,
    );
    expect(await readGrounderState(env.home)).toEqual({
      grounderVersion: VERSION,
      agents: {
        cursor: {
          commandsSchema: 1,
          files: await expectedFileLedger(cursor.expectedArtifacts(env.home)),
        },
      },
    });
  });

  it("is idempotent on re-run", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    const noteBefore = await readFile(grounderNoteCommandPath(env.home), "utf8");
    const handoffBefore = await readFile(grounderTaskHandoffCommandPath(env.home), "utf8");

    const code = await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    expect(code).toBe(0);
    expect(await readFile(grounderNoteCommandPath(env.home), "utf8")).toBe(noteBefore);
    expect(await readFile(grounderTaskHandoffCommandPath(env.home), "utf8")).toBe(handoffBefore);
  });

  it("returns error before prompting when vault already configured to a different path", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    // First init succeeds
    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: [],
    });

    // Re-init with a different vault path and no --force should fail immediately (exit 1)
    // without hanging on a confirmation prompt (yes: false but no TTY needed since it errors first)
    const code = await runVaultInitWithOptions({
      vaultPath: `${env.vault}-other`,
      yes: false,
      homeDir: env.home,
      agents: [],
    });

    expect(code).toBe(1);
  });

  describe("--hooks", () => {
    it("installs session hooks for selected agents", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const { code, out } = await captureStdout(() =>
        runVaultInitWithOptions({
          vaultPath: env.vault,
          yes: true,
          hooks: true,
          homeDir: env.home,
          agents: ["cursor", "claude"],
        }),
      );

      expect(code).toBe(0);
      expect(out).toContain(`hook ${cursorHooksJsonPath(env.home)}`);
      expect(out).toContain(`hook ${claudeSettingsJsonPath(env.home)}`);
      expect(out).toContain(`Cursor hook installed: ${cursorHooksJsonPath(env.home)}`);
      expect(out).toContain(`Claude Code hook installed: ${claudeSettingsJsonPath(env.home)}`);
      expect(out).toMatch(/Grounder runtime installed \((symlink|copy)\):/);

      expect(JSON.parse(await readFile(cursorHooksJsonPath(env.home), "utf8"))).toEqual({
        version: 1,
        hooks: {
          sessionStart: [{ command: cursorPeekHookCommand(env.home) }],
        },
      });
      expect(JSON.parse(await readFile(claudeSettingsJsonPath(env.home), "utf8"))).toMatchObject({
        hooks: {
          SessionStart: [
            {
              matcher: "startup|clear|compact",
              hooks: [{ type: "command", command: claudePeekHookCommand(env.home) }],
            },
          ],
        },
      });
      expect(await readGrounderState(env.home)).toEqual({
        grounderVersion: VERSION,
        agents: {
          cursor: {
            commandsSchema: 1,
            hooksSchema: 1,
            files: await expectedFileLedger(cursor.expectedArtifacts(env.home)),
          },
          claude: {
            commandsSchema: 1,
            hooksSchema: 1,
            files: await expectedFileLedger(claude.expectedArtifacts(env.home)),
          },
        },
      });
      expect(statePath(env.home)).toBe(path.join(env.home, ".grounder", "state.json"));
    });

    it("omits hook artifacts when --hooks is not set", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const { code, out } = await captureStdout(() =>
        runVaultInitWithOptions({
          vaultPath: env.vault,
          yes: true,
          homeDir: env.home,
          agents: ["cursor", "claude"],
        }),
      );

      expect(code).toBe(0);
      expect(out).not.toMatch(/\bhook\b/);
      expect(await fileExists(cursorHooksJsonPath(env.home))).toBe(false);
      expect(await fileExists(claudeSettingsJsonPath(env.home))).toBe(false);
      await access(grounderNoteCommandPath(env.home));
    });

    it("scopes hooks to --agent when set", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const code = await runVaultInitWithOptions({
        vaultPath: env.vault,
        yes: true,
        hooks: true,
        homeDir: env.home,
        agents: ["cursor"],
      });

      expect(code).toBe(0);
      expect(await fileExists(cursorHooksJsonPath(env.home))).toBe(true);
      expect(await fileExists(claudeSettingsJsonPath(env.home))).toBe(false);
    });

    it("parses --hooks from argv", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;
      previousGrounderHome = process.env.GROUNDER_HOME;
      process.env.GROUNDER_HOME = env.home;
      restoredGrounderHome = true;

      const code = await runVaultInit([env.vault, "--yes", "--hooks", "--agent", "cursor"]);

      expect(code).toBe(0);
      expect(await fileExists(cursorHooksJsonPath(env.home))).toBe(true);
      expect(await fileExists(claudeSettingsJsonPath(env.home))).toBe(false);
    });
  });
});
