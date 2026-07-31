import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { grounderTaskCommandPath } from "../../src/agents/cursor.js";
import { runDoctorWithOptions } from "../../src/commands/doctor.js";
import { runRepoInitWithOptions } from "../../src/commands/repo/init.js";
import { runVaultInitWithOptions } from "../../src/commands/vault/init.js";
import { writeRepoConfig } from "../../src/connector/repo.js";
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
    expect(out).toContain("ok    agent-cursor");
    expect(out).toContain("ok    agent-cursor-hooks");
    expect(out).toContain("Project\n");
    expect(out).toContain("ok    repo-config");
    expect(out).toContain("ok    notes-dir");
    expect(out).toContain("ok    logs-dir");
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

  it("hints vault init for notes/logs when home is missing but repo config exists", async () => {
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
    expect(out).toContain("grounder vault init <path> --force");
    expect(out).toContain("ok    agent-cursor-hooks");
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
    expect(out).toContain("warn  agent-cursor");
    expect(out).toContain("no Grounder command files");
    expect(out).toContain("warn  agent-cursor-hooks");
    expect(out).toContain("no Grounder session hook → grounder vault init <path> --hooks");
    expect(out).toMatch(/^\d+ passed, 0 failed, 2 warned$/m);
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
    expect(out).toContain("no Grounder session hook → grounder vault init <path> --hooks");
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
    expect(out).not.toContain("Project\n");
    expect(out).not.toContain("repo-config");
    expect(out).toMatch(/^\d+ passed, 0 failed, 0 warned$/m);
  });
});
