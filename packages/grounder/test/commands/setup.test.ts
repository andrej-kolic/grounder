import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claude, claudePeekHookCommand, claudeSettingsJsonPath } from "../../src/agents/claude.js";
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
import { LEDGER_SCHEMA, readGrounderState, statePath } from "../../src/connector/state.js";
import { VERSION } from "../../src/index.js";
import { fileExists } from "../../src/util/fs.js";
import { hashContent } from "../../src/util/hash.js";
import { captureStdout, createTempEnv, hasRow } from "../helpers.js";

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
    expect(out).toContain(`cursor  ${grounderNoteCommandPath(env.home)}`);
    expect(out).toContain(`cursor  ${grounderPlanCommandPath(env.home)}`);
    expect(out).toContain(`cursor  ${grounderTaskHandoffCommandPath(env.home)}`);
    expect(out).not.toContain("(Cursor artifacts)");
    expect(hasRow(out, "created", grounderNoteCommandPath(env.home))).toBe(true);
    expect(hasRow(out, "created", statePath(env.home))).toBe(true);
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
      ledgerSchema: LEDGER_SCHEMA,
      grounderVersion: VERSION,
      agents: {
        cursor: {
          files: await expectedFileLedger(cursor.expectedArtifacts(env.home)),
          lastInvocation: cli,
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

    const { code, out } = await captureStdout(() =>
      runSetupWithOptions({
        vaultPath: env.vault,
        yes: true,
        homeDir: env.home,
        agents: ["cursor"],
      }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Nothing to do");
    expect(hasRow(out, "unchanged", grounderNoteCommandPath(env.home))).toBe(true);
    expect(hasRow(out, "unchanged", statePath(env.home))).toBe(true);
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
    expect(out).toContain(`home    ${homeConfigPath(env.home)}`);
    expect(out).toContain("vault   10-Projects/ (if missing)");
    expect(out).toContain(`runtime ${runtimeCliPath(env.home)}`);
    expect(out).toContain(`cursor  ${grounderNoteCommandPath(env.home)}`);
    expect(out).toContain(`hook ${cursorHooksJsonPath(env.home)}`);
    expect(out).not.toContain("✓ Wrote home config");

    // The dry run also applies (without writing) and renders the same
    // STATUS/TARGET/PATH table + summary a real run would, via `reportAgentInstalls`.
    expect(out).toContain("STATUS");
    expect(out).toContain("TARGET");
    expect(hasRow(out, "created", grounderNoteCommandPath(env.home))).toBe(true);
    expect(hasRow(out, "created", cursorHooksJsonPath(env.home))).toBe(true);
    expect(hasRow(out, "created", statePath(env.home))).toBe(true);
    expect(out).toContain("Would create");
    expect(out).toContain("Run without --dry-run to apply.");

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
        "Home config and vault scaffold were written, but agent skill files/hooks were not installed",
      );
      expect(stderrOut).toContain("grounder migrate --force");
      expect(JSON.parse(await readFile(homeConfigPath(env.home), "utf8"))).toEqual({
        vaultRoot: env.vault,
      });
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("dry-run reports upgrade grounder when the ledger's own schema is newer than this binary", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await mkdir(path.dirname(statePath(env.home)), { recursive: true });
    await writeFile(
      statePath(env.home),
      `${JSON.stringify(
        { ledgerSchema: LEDGER_SCHEMA + 1, grounderVersion: "9.9.9", agents: {} },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const stderrChunks: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    });

    try {
      const { code } = await captureStdout(() =>
        runSetupWithOptions({
          vaultPath: env.vault,
          dryRun: true,
          homeDir: env.home,
          agents: ["cursor"],
        }),
      );

      expect(code).toBe(1);
      expect(stderrChunks.join("")).toContain("Upgrade grounder");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("reports upgrade grounder (not the generic partial-success message) on a real run", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await mkdir(path.dirname(statePath(env.home)), { recursive: true });
    await writeFile(
      statePath(env.home),
      `${JSON.stringify(
        { ledgerSchema: LEDGER_SCHEMA + 1, grounderVersion: "9.9.9", agents: {} },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const stderrChunks: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    });

    try {
      const { code } = await captureStdout(() =>
        runSetupWithOptions({
          vaultPath: env.vault,
          yes: true,
          homeDir: env.home,
          agents: ["cursor"],
        }),
      );

      expect(code).toBe(1);
      const stderrOut = stderrChunks.join("");
      expect(stderrOut).toContain("Upgrade grounder");
      expect(stderrOut).not.toContain("agent skill files/hooks were not installed");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("isolates a bad hook config to the one agent, still installing the others", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    // A `hooks` key that isn't a JSON object — `readHooksObject` refuses
    // rather than clobbering it, and that refusal must not take Claude
    // Code's install down with it.
    await mkdir(path.dirname(cursorHooksJsonPath(env.home)), { recursive: true });
    await writeFile(
      cursorHooksJsonPath(env.home),
      `${JSON.stringify({ version: 1, hooks: [] }, null, 2)}\n`,
      "utf8",
    );

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
          hooks: true,
          homeDir: env.home,
          agents: ["cursor", "claude"],
        }),
      );

      expect(code).toBe(1);
      const stderrOut = stderrChunks.join("");
      expect(stderrOut).toContain("cursor:");
      expect(stderrOut).toContain("Refusing to modify");

      for (const artifact of claude.expectedArtifacts(env.home)) {
        expect(await fileExists(artifact)).toBe(true);
      }
      expect(await fileExists(claudeSettingsJsonPath(env.home))).toBe(true);

      const state = await readGrounderState(env.home);
      expect(state?.agents.claude?.hooksEnabled).toBe(true);
      expect(Object.keys(state?.agents.claude?.files ?? {}).length).toBeGreaterThan(0);

      // Cursor's own whole-file skills still installed too — only its hook
      // step failed.
      for (const artifact of cursor.expectedArtifacts(env.home)) {
        expect(await fileExists(artifact)).toBe(true);
      }
      expect(state?.agents.cursor).toBeDefined();
      expect(out).not.toContain("agent skill files/hooks were not installed");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("rewrites a real v0.5.0 ledger to the current schema, dropping legacy keys", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    const state = await readGrounderState(env.home);
    if (!state) {
      throw new Error("expected install state after setup");
    }
    // A real v0.5.0 ledger: commandsSchema/hooksSchema, no ledgerSchema field at all.
    await writeFile(
      statePath(env.home),
      `${JSON.stringify(
        {
          grounderVersion: "0.5.0",
          agents: {
            cursor: {
              commandsSchema: 4,
              hooksSchema: 1,
              files: state.agents.cursor?.files ?? {},
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    const onDisk = JSON.parse(await readFile(statePath(env.home), "utf8"));
    expect(onDisk.ledgerSchema).toBe(LEDGER_SCHEMA);
    expect(onDisk.grounderVersion).not.toBe("0.5.0");
    expect(onDisk.agents.cursor.commandsSchema).toBeUndefined();
    expect(onDisk.agents.cursor.hooksSchema).toBeUndefined();
    expect(onDisk.agents.cursor.hooksEnabled).toBe(true);
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

  it("reports pre-existing locally modified skill files as a conflict and suggests --force", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    // Simulates a skill file left over from before Grounder tracked hashes
    // (or a hand edit) — a fresh setup should not silently overwrite it.
    await mkdir(path.dirname(grounderNoteCommandPath(env.home)), { recursive: true });
    await writeFile(grounderNoteCommandPath(env.home), "hand-edited skill file\n", "utf8");

    const { code, out } = await captureStdout(() =>
      runSetupWithOptions({
        vaultPath: env.vault,
        yes: true,
        homeDir: env.home,
        agents: ["cursor"],
      }),
    );

    expect(code).toBe(0);
    expect(hasRow(out, "conflict", grounderNoteCommandPath(env.home))).toBe(true);
    expect(out).toContain("left alone");
    expect(out).toContain("Run 'grounder migrate --force' to overwrite it");
    expect(await readFile(grounderNoteCommandPath(env.home), "utf8")).toBe(
      "hand-edited skill file\n",
    );
  });

  it("dry-run reports a pre-existing locally modified skill file as a conflict, pointing at --force not --dry-run", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    // Install for real first, then hand-edit one file, so re-running with
    // --dry-run has only that one conflict pending (everything else current)
    // — otherwise the still-to-be-created files would also show as pending
    // work and the summary would legitimately still say "Run without
    // --dry-run to apply" alongside the conflict.
    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await writeFile(grounderNoteCommandPath(env.home), "hand-edited skill file\n", "utf8");

    const { code, out } = await captureStdout(() =>
      runSetupWithOptions({
        vaultPath: env.vault,
        dryRun: true,
        homeDir: env.home,
        agents: ["cursor"],
      }),
    );

    expect(code).toBe(0);
    expect(hasRow(out, "conflict", grounderNoteCommandPath(env.home))).toBe(true);
    expect(out).toContain("left alone");
    expect(out).toContain("Run 'grounder migrate --force' to overwrite it");
    expect(out).not.toContain("Nothing to do");
    expect(out).not.toContain("Run without --dry-run to apply");
    expect(await readFile(grounderNoteCommandPath(env.home), "utf8")).toBe(
      "hand-edited skill file\n",
    );
  });

  it("dry-run first-time setup with a pre-existing conflicting file points at 'grounder setup --force', not 'grounder migrate --force'", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    // Genuine first-time setup: no prior `runSetupWithOptions` call, so
    // `~/.grounder/config.json` does not exist yet. Simulates a skill file
    // left over from before Grounder tracked hashes (or a hand edit).
    await mkdir(path.dirname(grounderNoteCommandPath(env.home)), { recursive: true });
    await writeFile(grounderNoteCommandPath(env.home), "hand-edited skill file\n", "utf8");

    const { code, out } = await captureStdout(() =>
      runSetupWithOptions({
        vaultPath: env.vault,
        dryRun: true,
        homeDir: env.home,
        agents: ["cursor"],
      }),
    );

    expect(code).toBe(0);
    expect(hasRow(out, "conflict", grounderNoteCommandPath(env.home))).toBe(true);
    expect(out).toContain("left alone");
    // `grounder migrate --force` would fail here ("No home config found")
    // since this dry run never wrote `~/.grounder/config.json` — the
    // remediation command must be one that actually works right now.
    expect(out).not.toContain("grounder migrate --force");
    expect(out).toContain(`Run 'grounder setup ${env.vault} --force' to overwrite it`);
    expect(await fileExists(homeConfigPath(env.home))).toBe(false);

    // Prove the suggested remediation actually works: `grounder migrate
    // --force` would fail here since no home config exists yet, but
    // `grounder setup <path> --force` both creates it and resolves the
    // conflict in one command.
    const forced = await captureStdout(() =>
      runSetupWithOptions({
        vaultPath: env.vault,
        force: true,
        yes: true,
        homeDir: env.home,
        agents: ["cursor"],
      }),
    );
    expect(forced.code).toBe(0);
    expect(hasRow(forced.out, "updated", grounderNoteCommandPath(env.home))).toBe(true);
    expect(await readFile(grounderNoteCommandPath(env.home), "utf8")).not.toBe(
      "hand-edited skill file\n",
    );
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
      expect(hasRow(out, "created", cursorHooksJsonPath(env.home), "cursor hook")).toBe(true);
      expect(hasRow(out, "created", claudeSettingsJsonPath(env.home), "claude hook")).toBe(true);
      expect(hasRow(out, "created", runtimeCliPath(env.home))).toBe(true);
      expect(hasRow(out, "created", statePath(env.home))).toBe(true);

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
      const cli = runtimeInvocation(env.home);
      expect(await readGrounderState(env.home)).toEqual({
        ledgerSchema: LEDGER_SCHEMA,
        grounderVersion: VERSION,
        agents: {
          cursor: {
            hooksEnabled: true,
            files: await expectedFileLedger(cursor.expectedArtifacts(env.home)),
            lastInvocation: cli,
          },
          claude: {
            hooksEnabled: true,
            files: await expectedFileLedger(claude.expectedArtifacts(env.home)),
            lastInvocation: cli,
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
