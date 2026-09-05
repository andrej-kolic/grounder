import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLinkWithOptions } from "../../../src/commands/link.js";
import { runSetupWithOptions } from "../../../src/commands/setup.js";
import { runStatus, runStatusWithOptions } from "../../../src/commands/status.js";
import { homeConfigPath } from "../../../src/connector/home.js";
import { writeRepoConfig } from "../../../src/connector/repo.js";
import {
  LEDGER_SCHEMA,
  readGrounderState,
  statePath,
  writeGrounderState,
} from "../../../src/connector/state.js";
import {
  resolveLogsDir,
  resolveNotesDir,
  resolvePlansDir,
  resolveProjectVaultRoot,
} from "../../../src/connector/vault.js";
import { VERSION } from "../../../src/index.js";
import { captureStdout, createTempEnv } from "../../helpers.js";

interface StatusJsonPayload {
  machine: {
    configPath: string;
    configState: "ok" | "missing" | "invalid";
    vaultRoot: string | null;
    state: {
      path: string;
      status: "ok" | "missing" | "invalid" | "unsupported";
      packageVersionNotice: string | null;
      installCurrent: boolean | null;
    } | null;
  };
  project: {
    linked: boolean;
    folder: string | null;
    isAncestorLink: boolean;
    configPath: string | null;
    configState: "ok" | "missing" | "invalid" | "unsupported";
    projectId: string | null;
    vaultRoot: string | null;
    notesDir: string | null;
    logsDir: string | null;
    plansDir: string | null;
    git: { root: string; branch: string | null } | null;
  };
}

const REPO_CONFIG = { version: 1 as const, projectId: "my-app" };

async function captureStderr(fn: () => Promise<number>): Promise<{ code: number; err: string }> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    const code = await fn();
    return { code, err: chunks.join("") };
  } finally {
    spy.mockRestore();
  }
}

async function statusJson(cwd: string, homeDir: string): Promise<StatusJsonPayload> {
  const { code, out } = await captureStdout(() =>
    runStatusWithOptions({ cwd, homeDir, json: true }),
  );
  expect(code).toBe(0);
  const lines = out.trim().split("\n");
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0] as string) as StatusJsonPayload;
}

describe("commands/status --json", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("locks the full payload shape for a fully linked project", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const payload = await statusJson(env.repo, env.home);
    const home = { vaultRoot: env.vault };

    // No commit is made in the temp repo, so `git rev-parse` has no HEAD to
    // resolve yet — branch is deterministically null here, not "main"/"master".
    expect(payload.machine).toEqual({
      configPath: homeConfigPath(env.home),
      configState: "ok",
      vaultRoot: env.vault,
      state: {
        path: statePath(env.home),
        status: "ok",
        packageVersionNotice: null,
        installCurrent: true,
      },
    });
    expect(payload.project).toEqual({
      linked: true,
      folder: env.repo,
      isAncestorLink: false,
      configPath: path.join(env.repo, ".grounder.json"),
      configState: "ok",
      projectId: "my-app",
      vaultRoot: resolveProjectVaultRoot(home, REPO_CONFIG),
      notesDir: resolveNotesDir(home, REPO_CONFIG),
      logsDir: resolveLogsDir(home, REPO_CONFIG),
      plansDir: resolvePlansDir(home, REPO_CONFIG),
      git: { root: env.repo, branch: null },
    });
  });

  it("reports null machine/project fields when nothing is configured", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    const payload = await statusJson(env.repo, env.home);

    expect(payload.machine).toEqual({
      configPath: homeConfigPath(env.home),
      configState: "missing",
      vaultRoot: null,
      state: null,
    });
    expect(payload.project).toEqual({
      linked: false,
      folder: null,
      isAncestorLink: false,
      configPath: null,
      configState: "missing",
      projectId: null,
      vaultRoot: null,
      notesDir: null,
      logsDir: null,
      plansDir: null,
      git: null,
    });
  });

  it("reports invalid home config while the project stays linked", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await mkdir(path.dirname(homeConfigPath(env.home)), { recursive: true });
    await writeFile(homeConfigPath(env.home), "{not-json", "utf8");
    await writeRepoConfig(env.repo, REPO_CONFIG);

    const payload = await statusJson(env.repo, env.home);

    expect(payload.machine.configState).toBe("invalid");
    expect(payload.machine.vaultRoot).toBeNull();
    expect(payload.machine.state).toBeNull();

    expect(payload.project.linked).toBe(true);
    expect(payload.project.configState).toBe("ok");
    expect(payload.project.projectId).toBe("my-app");
    expect(payload.project.vaultRoot).toBeNull();
    expect(payload.project.notesDir).toBeNull();
  });

  it("distinguishes invalid repo config from unsupported", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await writeFile(path.join(env.repo, ".grounder.json"), '{"version":1}\n', "utf8");

    const payload = await statusJson(env.repo, env.home);

    expect(payload.project.linked).toBe(true);
    expect(payload.project.configState).toBe("invalid");
    expect(payload.project.projectId).toBeNull();
  });

  it("reports unsupported repo config as a distinct configState", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await writeFile(
      path.join(env.repo, ".grounder.json"),
      `${JSON.stringify({ version: 2, projectId: "my-app" }, null, 2)}\n`,
      "utf8",
    );

    const payload = await statusJson(env.repo, env.home);

    expect(payload.project.linked).toBe(true);
    expect(payload.project.configState).toBe("unsupported");
    expect(payload.project.projectId).toBeNull();
  });

  it("reports project unlinked while the machine config is ok", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });

    const payload = await statusJson(env.repo, env.home);

    expect(payload.machine.configState).toBe("ok");
    expect(payload.project.linked).toBe(false);
    expect(payload.project.configState).toBe("missing");
    expect(payload.project.git).toBeNull();
  });

  it("reports a linked project with vault paths null when there is no home config", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await writeRepoConfig(env.repo, REPO_CONFIG);

    const payload = await statusJson(env.repo, env.home);

    expect(payload.machine.configState).toBe("missing");
    expect(payload.project.linked).toBe(true);
    expect(payload.project.configState).toBe("ok");
    expect(payload.project.projectId).toBe("my-app");
    expect(payload.project.vaultRoot).toBeNull();
    expect(payload.project.notesDir).toBeNull();
    expect(payload.project.logsDir).toBeNull();
    expect(payload.project.plansDir).toBeNull();
  });

  it("reports missing install state when state.json is absent", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await rm(statePath(env.home), { force: true });

    const payload = await statusJson(env.repo, env.home);

    expect(payload.machine.state).toEqual({
      path: statePath(env.home),
      status: "missing",
      packageVersionNotice: null,
      installCurrent: null,
    });
  });

  it("reports invalid install state", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await writeFile(statePath(env.home), "{not-json", "utf8");

    const payload = await statusJson(env.repo, env.home);

    expect(payload.machine.state).toEqual({
      path: statePath(env.home),
      status: "invalid",
      packageVersionNotice: null,
      installCurrent: null,
    });
  });

  it("reports unsupported ledger schema without an install-current verdict", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
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
    await writeGrounderState({ ...state, ledgerSchema: LEDGER_SCHEMA + 1 }, env.home);

    const payload = await statusJson(env.repo, env.home);

    expect(payload.machine.state).toEqual({
      path: statePath(env.home),
      status: "unsupported",
      packageVersionNotice: null,
      installCurrent: null,
    });
  });

  it("surfaces a plain-language packageVersionNotice when the ledger version disagrees", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
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
    await writeGrounderState({ ...state, grounderVersion: "0.1.0" }, env.home);

    const payload = await statusJson(env.repo, env.home);

    expect(payload.machine.state?.status).toBe("ok");
    expect(payload.machine.state?.packageVersionNotice).toBe(
      `Grounder ${VERSION} is installed, but your configuration is still from 0.1.0`,
    );
    expect(payload.machine.state?.installCurrent).toBe(true);
  });

  it("surfaces a plain-language packageVersionNotice when this Grounder is older than the ledger", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
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
    await writeGrounderState({ ...state, grounderVersion: "99.0.0" }, env.home);

    const payload = await statusJson(env.repo, env.home);

    expect(payload.machine.state?.status).toBe("ok");
    expect(payload.machine.state?.packageVersionNotice).toBe(
      `this Grounder (${VERSION}) is older than your configuration (99.0.0)`,
    );
    expect(VERSION).not.toBe("99.0.0");
  });

  it("reports installCurrent false when the ledger has drift", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await writeGrounderState(
      { ledgerSchema: LEDGER_SCHEMA, grounderVersion: VERSION, agents: { cursor: { files: {} } } },
      env.home,
    );

    const payload = await statusJson(env.repo, env.home);

    expect(payload.machine.state?.status).toBe("ok");
    expect(payload.machine.state?.installCurrent).toBe(false);
  });

  it("flags an ancestor link in JSON when cwd is an unlinked subdirectory", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const subdir = path.join(env.repo, "fixtures", "dev");
    await mkdir(subdir, { recursive: true });

    const payload = await statusJson(subdir, env.home);

    expect(payload.project.linked).toBe(true);
    expect(payload.project.folder).toBe(env.repo);
    expect(payload.project.isAncestorLink).toBe(true);
  });

  it("prints the same JSON payload through argv parsing (grounder status --json)", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    // Resolve through the real path: chdir + process.cwd() returns the
    // OS-resolved path (macOS temp dirs are under a /private symlink), while
    // env.repo is the unresolved path createTempEnv handed back.
    const resolvedRepo = await realpath(env.repo);
    const prevCwd = process.cwd();
    process.chdir(env.repo);
    try {
      const { code, out } = await captureStdout(() => runStatus(["--json"]));

      expect(code).toBe(0);
      const payload = JSON.parse(out.trim()) as StatusJsonPayload;
      expect(payload.project.linked).toBe(true);
      expect(payload.project.folder).toBe(resolvedRepo);
      expect(payload.project.projectId).toBe("my-app");
      expect(payload.machine.configState).toBe("ok");
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("rejects unknown flags", async () => {
    const { code, err } = await captureStderr(() => runStatus(["--bogus"]));

    expect(code).toBe(1);
    expect(err).toContain("Usage: grounder status");
  });

  it("rejects positional arguments", async () => {
    const { code, err } = await captureStderr(() => runStatus(["extra"]));

    expect(code).toBe(1);
    expect(err).toContain("Usage: grounder status");
  });
});
