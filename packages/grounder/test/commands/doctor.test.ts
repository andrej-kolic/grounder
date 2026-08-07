import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { grounderTaskCommandPath } from "../../src/agents/cursor.js";
import { grounderRuntimeDir } from "../../src/agents/hook-runtime.js";
import { runDoctorWithOptions } from "../../src/commands/doctor.js";
import { runRepoInitWithOptions } from "../../src/commands/repo/init.js";
import { runVaultInitWithOptions } from "../../src/commands/vault/init.js";
import { writeRepoConfig } from "../../src/connector/repo.js";
import { statePath, writeGrounderState } from "../../src/connector/state.js";
import { captureStdout, createTempEnv } from "../helpers.js";

describe("commands/doctor", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("passes for a healthy linked project", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      hooks: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runDoctorWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Machine\n");
    expect(out).toContain("ok    home-config");
    expect(out).toContain("ok    vault");
    expect(out).toContain("ok    projects-dir");
    expect(out).toContain("ok    install-state");
    expect(out).toContain("ok    agent-cursor");
    expect(out).toContain("ok    agent-cursor-hooks");
    expect(out).toContain("ok    hook-runtime");
    expect(out).toContain("Project\n");
    expect(out).toContain("ok    repo-config");
    expect(out).toContain("ok    notes-dir");
    expect(out).toContain("ok    logs-dir");
    expect(out).toContain("ok    plans-dir");
    expect(out).toContain("ok    git");
    expect(out).toMatch(/^\d+ passed, 0 failed, 0 warned$/m);
  });

  it("fails when home config is missing", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    const { code, out } = await captureStdout(() =>
      runDoctorWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(1);
    expect(out).toContain("fail  home-config");
    expect(out).toContain("grounder vault init <path>");
    expect(out).toContain("fail  vault");
    expect(out).toContain("Project\n");
    expect(out).toContain("fail  repo-config");
  });

  it("hints vault init for notes/logs/plans when home is missing but repo config exists", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await writeRepoConfig(env.repo, { version: 1, projectId: "my-app" });

    const { code, out } = await captureStdout(() =>
      runDoctorWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(1);
    expect(out).toContain("ok    repo-config");
    expect(out).toContain("fail  notes-dir");
    expect(out).toContain("cannot resolve notes/ (no home config) → grounder vault init <path>");
    expect(out).toContain("cannot resolve logs/ (no home config) → grounder vault init <path>");
    expect(out).toContain("cannot resolve plans/ (no home config) → grounder vault init <path>");
  });

  it("fails when repo config is missing", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    const { code, out } = await captureStdout(() =>
      runDoctorWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(1);
    expect(out).toContain("ok    home-config");
    expect(out).toContain("fail  repo-config");
    expect(out).toContain("no .grounder.json uptree → grounder init");
    expect(out).toContain("fail  notes-dir");
    expect(out).toContain("fail  logs-dir");
    expect(out).toContain("fail  plans-dir");
  });

  it("fails when a detected agent is missing a command file", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      hooks: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    await rm(grounderTaskCommandPath(env.home));

    const { code, out } = await captureStdout(() =>
      runDoctorWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(1);
    expect(out).toContain("fail  agent-cursor");
    expect(out).toContain("grounder-task.md");
    expect(out).toContain("grounder migrate --force");
    expect(out).toContain("ok    agent-cursor-hooks");
    expect(out).toContain("ok    hook-runtime");
  });

  it("warns when install state is missing (legacy pre-ledger install)", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      hooks: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    // Pre-ledger installs have command files but no ~/.grounder/state.json →
    // treat as schema 0 (same migrate hint as the old npx content sniff).
    await rm(statePath(env.home));

    const { code, out } = await captureStdout(() =>
      runDoctorWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("warn  install-state");
    expect(out).toContain("install state missing (pre-ledger / never migrated)");
    expect(out).toContain("warn  agent-cursor");
    expect(out).toContain("commands schema stale (recorded 0, current 1) — migrate");
    expect(out).toContain("grounder migrate --force");
    expect(out).toContain("warn  agent-cursor-hooks");
    expect(out).toContain("hooks schema stale (recorded 0, current 1) — migrate");
    expect(out).toMatch(/^\d+ passed, 0 failed, 3 warned$/m);
  });

  it("warns when recorded commands schema is behind the adapter", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    await writeGrounderState(
      {
        grounderVersion: "0.1.0",
        agents: {
          cursor: { commandsSchema: 0, files: {} },
        },
      },
      env.home,
    );

    const { code, out } = await captureStdout(() =>
      runDoctorWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("warn  agent-cursor");
    expect(out).toContain("commands schema stale (recorded 0, current 1) — migrate");
    expect(out).toContain("grounder migrate --force");
    expect(out).toMatch(/^\d+ passed, 0 failed, \d+ warned$/m);
  });

  it("warns when recorded hooks schema is behind the adapter", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      hooks: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    await writeGrounderState(
      {
        grounderVersion: "0.1.0",
        agents: {
          cursor: { commandsSchema: 1, hooksSchema: 0, files: {} },
        },
      },
      env.home,
    );

    const { code, out } = await captureStdout(() =>
      runDoctorWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("ok    agent-cursor");
    expect(out).toContain("warn  agent-cursor-hooks");
    expect(out).toContain("hooks schema stale (recorded 0, current 1) — migrate");
    expect(out).toContain("grounder migrate");
    expect(out).toMatch(/^\d+ passed, 0 failed, 1 warned$/m);
  });

  it("fails when install state is corrupt", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    await writeFile(statePath(env.home), '{"agents":{}}\n', "utf8");

    const { code, out } = await captureStdout(() =>
      runDoctorWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(1);
    expect(out).toContain("fail  install-state");
    expect(out).toContain("missing grounderVersion");
    expect(out).toContain("fix or remove");
    expect(out).toContain("grounder migrate --force");
    // Presence still ok — do not invent a schema-0 migrate warn on corrupt ledger.
    expect(out).toContain("ok    agent-cursor");
    expect(out).not.toContain("commands schema stale");
  });

  it("fails when recorded schemas are newer than this grounder", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      hooks: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    await writeGrounderState(
      {
        grounderVersion: "9.9.9",
        agents: {
          cursor: { commandsSchema: 99, hooksSchema: 50, files: {} },
        },
      },
      env.home,
    );

    const { code, out } = await captureStdout(() =>
      runDoctorWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(1);
    expect(out).toContain("fail  agent-cursor");
    expect(out).toContain("commands schema newer than this grounder (recorded 99, supported 1)");
    expect(out).toContain("fail  agent-cursor-hooks");
    expect(out).toContain("hooks schema newer than this grounder (recorded 50, supported 1)");
    expect(out).toContain("upgrade grounder");
    expect(out).not.toContain("commands schema stale");
  });

  it("fails when repo config version is newer than this grounder", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await writeFile(
      path.join(env.repo, ".grounder.json"),
      `${JSON.stringify({ version: 2, projectId: "my-app" }, null, 2)}\n`,
      "utf8",
    );

    const { code, out } = await captureStdout(() =>
      runDoctorWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(1);
    expect(out).toContain("fail  repo-config-valid");
    expect(out).toContain("Upgrade grounder");
    expect(out).toContain("→ upgrade grounder");
    expect(out).toContain("unsupported repo config version");
    expect(out).not.toContain("grounder init --force");
  });

  it("warns when a detected agent has no command files", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
    });
    await mkdir(path.join(env.home, ".cursor"), { recursive: true });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runDoctorWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("warn  install-state");
    expect(out).toContain("warn  agent-cursor");
    expect(out).toContain("no Grounder command files");
    expect(out).toContain("warn  agent-cursor-hooks");
    expect(out).toContain("no Grounder session hook → grounder migrate --hooks");
    expect(out).toMatch(/^\d+ passed, 0 failed, 3 warned$/m);
  });

  it("warns (never fails) when session hooks are absent", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runDoctorWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("ok    agent-cursor");
    expect(out).toContain("warn  agent-cursor-hooks");
    expect(out).toContain("no Grounder session hook → grounder migrate --hooks");
    // Slash commands were installed (hooks were not), so the shared runtime is
    // still checked — it just doesn't depend on hooks being installed.
    expect(out).toContain("ok    hook-runtime");
    expect(out).toMatch(/^\d+ passed, 0 failed, 1 warned$/m);
  });

  it("warns (never fails) when hook runtime is stale", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      hooks: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    await rm(grounderRuntimeDir(env.home), { recursive: true, force: true });

    const { code, out } = await captureStdout(() =>
      runDoctorWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toContain("ok    agent-cursor-hooks");
    expect(out).toContain("warn  hook-runtime");
    expect(out).toContain(
      "hook runtime stale or missing (re-run after upgrading, especially bare npx) → grounder migrate",
    );
    expect(out).toMatch(/^\d+ passed, 0 failed, 1 warned$/m);
  });

  it("skips project checks with --global", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      hooks: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    const { code, out } = await captureStdout(() =>
      runDoctorWithOptions({ cwd: env.repo, homeDir: env.home, global: true }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Machine\n");
    expect(out).toContain("ok    home-config");
    expect(out).toContain("ok    agent-cursor-hooks");
    expect(out).toContain("ok    hook-runtime");
    expect(out).not.toContain("Project\n");
    expect(out).not.toContain("repo-config");
    expect(out).toMatch(/^\d+ passed, 0 failed, 0 warned$/m);
  });
});
