import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claude,
  claudePeekHookCommand,
  claudeSettingsJsonPath,
  claudeStatuslineCommand,
} from "../../src/agents/claude.js";
import {
  cursor,
  cursorHooksJsonPath,
  cursorPeekHookCommand,
  grounderNoteCommandPath,
  grounderPlanCommandPath,
  grounderTaskHandoffCommandPath,
} from "../../src/agents/cursor.js";
import { runtimeCliPath, runtimeInvocation } from "../../src/agents/hook-runtime.js";
import { runSetup, runSetupWithOptions } from "../../src/commands/setup.js";
import { homeConfigPath } from "../../src/connector/home.js";
import { readGrounderState, statePath } from "../../src/connector/state.js";
import { VERSION } from "../../src/index.js";
import { fileExists } from "../../src/util/fs.js";
import { hashContent } from "../../src/util/hash.js";
import { captureStdout, createTempEnv } from "../helpers.js";

async function expectedFileLedger(paths: string[]): Promise<Record<string, { hash: string }>> {
  const files: Record<string, { hash: string }> = {};
  for (const p of paths) {
    files[p] = { hash: hashContent(await readFile(p, "utf8")) };
  }
  return files;
}

describe("commands/setup", () => {
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
      runSetupWithOptions({
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
    expect(await readFile(grounderPlanCommandPath(env.home), "utf8")).toContain(
      'required_permissions: ["all"]',
    );
    expect(await readFile(grounderTaskHandoffCommandPath(env.home), "utf8")).toContain(
      `${cli} handoff`,
    );
    expect(await readFile(grounderTaskHandoffCommandPath(env.home), "utf8")).toContain(
      'required_permissions: ["all"]',
    );
    expect(await readGrounderState(env.home)).toEqual({
      grounderVersion: VERSION,
      agents: {
        cursor: {
          commandsSchema: 3,
          files: await expectedFileLedger(cursor.expectedArtifacts(env.home)),
        },
      },
    });
  });

  it("is idempotent on re-run", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    const noteBefore = await readFile(grounderNoteCommandPath(env.home), "utf8");
    const handoffBefore = await readFile(grounderTaskHandoffCommandPath(env.home), "utf8");

    const code = await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    expect(code).toBe(0);
    expect(await readFile(grounderNoteCommandPath(env.home), "utf8")).toBe(noteBefore);
    expect(await readFile(grounderTaskHandoffCommandPath(env.home), "utf8")).toBe(handoffBefore);
  });

  it("dry-run previews writes without creating home config, vault scaffold, or agent artifacts", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const { code, out } = await captureStdout(() =>
      runSetupWithOptions({
        vaultPath: env.vault,
        dryRun: true,
        hooks: true,
        homeDir: env.home,
        agents: ["cursor"],
      }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Connect to a markdown vault (once per machine).");
    expect(out).toContain("Would write:");
    expect(out).not.toContain("Dry run");
    expect(out).not.toContain("Will write:");
    expect(out.indexOf("Connect to a markdown vault (once per machine).")).toBeLessThan(
      out.indexOf("Would write:"),
    );
    expect(out).toContain(`home   ${homeConfigPath(env.home)}`);
    expect(out).toContain("vault  10-Projects/ (if missing)");
    expect(out).toContain(`grounder runtime ${runtimeCliPath(env.home)}`);
    expect(out).toContain(`cursor   ${grounderNoteCommandPath(env.home)}`);
    expect(out).toContain(`hook ${cursorHooksJsonPath(env.home)}`);
    expect(out).not.toContain("✓ Wrote home config");

    expect(await fileExists(homeConfigPath(env.home))).toBe(false);
    expect(await fileExists(path.join(env.vault, "10-Projects"))).toBe(false);
    expect(await fileExists(grounderNoteCommandPath(env.home))).toBe(false);
    expect(await fileExists(cursorHooksJsonPath(env.home))).toBe(false);
    expect(await fileExists(runtimeCliPath(env.home))).toBe(false);
    expect(await fileExists(statePath(env.home))).toBe(false);
  });

  it("parses --dry-run from argv", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    previousGrounderHome = process.env.GROUNDER_HOME;
    process.env.GROUNDER_HOME = env.home;
    restoredGrounderHome = true;

    const { code, out } = await captureStdout(() =>
      runSetup([env.vault, "--dry-run", "--hooks", "--agent", "cursor"]),
    );

    expect(code).toBe(0);
    expect(out).toContain("Would write:");
    expect(out).not.toContain("Dry run");
    expect(await fileExists(homeConfigPath(env.home))).toBe(false);
    expect(await fileExists(cursorHooksJsonPath(env.home))).toBe(false);
  });

  it("self-heals a corrupt home config instead of crashing on dry-run", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await mkdir(path.dirname(homeConfigPath(env.home)), { recursive: true });
    await writeFile(homeConfigPath(env.home), "{not-json", "utf8");

    const { code, out } = await captureStdout(() =>
      runSetupWithOptions({
        vaultPath: env.vault,
        dryRun: true,
        homeDir: env.home,
        agents: [],
      }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Would replace invalid home config (");
    expect(out).not.toContain("grounder setup <path> to repair");
    expect(out).not.toContain("Invalid home config at");
    expect(out).toContain(`Vault root: ${env.vault}`);
    expect(out).toContain("Would write:");
  });

  it("self-heals a corrupt home config on apply, without needing --force", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await mkdir(path.dirname(homeConfigPath(env.home)), { recursive: true });
    await writeFile(homeConfigPath(env.home), "{not-json", "utf8");

    const code = await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: [],
    });

    expect(code).toBe(0);
    expect(JSON.parse(await readFile(homeConfigPath(env.home), "utf8"))).toEqual({
      vaultRoot: env.vault,
    });
  });

  it("dry-run fails when state.json is corrupt instead of hiding the problem", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await mkdir(path.dirname(statePath(env.home)), { recursive: true });
    await writeFile(statePath(env.home), "{not-json", "utf8");

    const stderrChunks: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    });

    try {
      const { code, out } = await captureStdout(() =>
        runSetupWithOptions({
          vaultPath: env.vault,
          dryRun: true,
          homeDir: env.home,
          agents: ["cursor"],
        }),
      );

      expect(code).toBe(1);
      expect(out).toContain("Would write:");
      const stderrOut = stderrChunks.join("");
      expect(stderrOut).toContain("Dry run failed: agent install would not succeed");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("reports partial success when state.json is corrupt during first-time setup", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await mkdir(path.dirname(statePath(env.home)), { recursive: true });
    await writeFile(statePath(env.home), "{not-json", "utf8");

    const stderrChunks: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    });

    try {
      const { code, out } = await captureStdout(() =>
        runSetupWithOptions({
          vaultPath: env.vault,
          yes: true,
          homeDir: env.home,
          agents: ["cursor"],
        }),
      );

      expect(code).toBe(1);
      expect(out).toContain("✓ Wrote home config");
      expect(out).toContain("✓ Vault scaffold:");
      const stderrOut = stderrChunks.join("");
      expect(stderrOut).toContain(
        "Home config and vault scaffold were written, but agent command files/hooks were not installed",
      );
      expect(stderrOut).toContain("grounder migrate --force");
      expect(JSON.parse(await readFile(homeConfigPath(env.home), "utf8"))).toEqual({
        vaultRoot: env.vault,
      });
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("returns error before prompting when vault already configured to a different path", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: [],
    });

    const code = await runSetupWithOptions({
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
        runSetupWithOptions({
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
        statusLine: { type: "command", command: claudeStatuslineCommand(env.home) },
      });
      expect(await readGrounderState(env.home)).toEqual({
        grounderVersion: VERSION,
        agents: {
          cursor: {
            commandsSchema: 3,
            hooksSchema: 1,
            files: await expectedFileLedger(cursor.expectedArtifacts(env.home)),
          },
          claude: {
            commandsSchema: 3,
            hooksSchema: 2,
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
        runSetupWithOptions({
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

      const code = await runSetupWithOptions({
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

      const code = await runSetup([env.vault, "--yes", "--hooks", "--agent", "cursor"]);

      expect(code).toBe(0);
      expect(await fileExists(cursorHooksJsonPath(env.home))).toBe(true);
      expect(await fileExists(claudeSettingsJsonPath(env.home))).toBe(false);
    });
  });
});
