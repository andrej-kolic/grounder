import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  labelFromHandoffFilename,
  runHandoffPeekWithOptions,
} from "../../../src/commands/handoff/peek.js";
import { runLinkWithOptions } from "../../../src/commands/link.js";
import { runSetupWithOptions } from "../../../src/commands/setup.js";
import { readGrounderState, writeGrounderState } from "../../../src/connector/state.js";
import { captureStdout, createTempEnv, withGroundedHome } from "../../helpers.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = path.join(pkgRoot, "dist", "cli.js");

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
  options?: { input?: string },
) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env,
    cwd,
    input: options?.input,
  });
}

describe("labelFromHandoffFilename", () => {
  it("strips second-precision timestamp prefix", () => {
    expect(labelFromHandoffFilename("/logs/2026-06-26-143000-auth-work.md")).toBe("auth work");
  });

  it("strips minute-precision timestamp prefix", () => {
    expect(labelFromHandoffFilename("/logs/2026-07-22-2310-phase-2-dogfood.md")).toBe(
      "phase 2 dogfood",
    );
  });

  it("returns empty when basename is only a timestamp", () => {
    expect(labelFromHandoffFilename("/logs/2026-06-26-143000.md")).toBe("");
  });
});

describe("commands/handoff/peek", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("prints nothing and exits 0 in an unlinked folder", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    const { code, out } = await captureStdout(() =>
      runHandoffPeekWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe("");
  });

  it("prints nothing and exits 0 when linked with no handoffs", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runHandoffPeekWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe("");
  });

  it("prints one-line teaser for the newest handoff", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await writeFile(
      path.join(logsDir, "2026-06-26-143000-older.md"),
      `---
project: "my-app"
created: "2026-06-26T14:30:00.000Z"
title: "older"
---

old
`,
      "utf8",
    );
    await writeFile(
      path.join(logsDir, "2026-06-26-150000-auth.md"),
      `---
project: "my-app"
created: "2026-06-26T15:00:00.000Z"
title: "auth"
---

# Handoff
`,
      "utf8",
    );

    const { code, out } = await captureStdout(() =>
      runHandoffPeekWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe(
      '[grounder] Latest handoff: "auth" (2026-06-26). Run /grounder-task to load it, or ignore if unrelated.\n',
    );
  });

  it("falls back to filename label when frontmatter is corrupted", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await writeFile(
      path.join(logsDir, "2026-06-26-143000-fix-auth.md"),
      "not frontmatter\n",
      "utf8",
    );

    const { code, out } = await captureStdout(() =>
      runHandoffPeekWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe(
      '[grounder] Latest handoff: "fix auth" (2026-06-26). Run /grounder-task to load it, or ignore if unrelated.\n',
    );
  });

  it("falls back to an older handoff when the newest file is empty", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await writeFile(
      path.join(logsDir, "2026-06-26-143000-auth.md"),
      `---
project: "my-app"
created: "2026-06-26T14:30:00.000Z"
title: "auth"
---

old
`,
      "utf8",
    );
    // Simulates a crashed/interrupted write — same path a real `writeHandoff` call
    // could leave behind if the process died right after file creation.
    await writeFile(path.join(logsDir, "2026-06-26-150000-empty.md"), "", "utf8");

    const { code, out } = await captureStdout(() =>
      runHandoffPeekWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe(
      '[grounder] Latest handoff: "auth" (2026-06-26). Run /grounder-task to load it, or ignore if unrelated.\n',
    );
  });

  it("reads unquoted legacy frontmatter and minute-precision filenames", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await writeFile(
      path.join(logsDir, "2026-07-22-2310-phase-2-dogfood.md"),
      `---
project: my-app
created: 2026-07-22T21:10:34.728Z
title: phase-2-dogfood
---

# Handoff
`,
      "utf8",
    );

    const { code, out } = await captureStdout(() =>
      runHandoffPeekWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe(
      '[grounder] Latest handoff: "phase-2-dogfood" (2026-07-22). Run /grounder-task to load it, or ignore if unrelated.\n',
    );
  });

  it("cli peeks silently when unlinked", () => {
    const result = runCli(["handoff", "peek"], withGroundedHome("/tmp/grounder-no-home-peek"));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("cli prints teaser from a linked repo", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(
      path.join(logsDir, "2026-06-26-150000-auth.md"),
      `---
created: "2026-06-26T15:00:00.000Z"
title: "auth"
---

body
`,
      "utf8",
    );

    const result = runCli(["handoff", "peek"], withGroundedHome(env.home), env.repo);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      '[grounder] Latest handoff: "auth" (2026-06-26). Run /grounder-task to load it, or ignore if unrelated.\n',
    );
  });

  it("cli finds linked repo via Cursor hook stdin workspace_roots", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(
      path.join(logsDir, "2026-06-26-150000-auth.md"),
      `---
created: "2026-06-26T15:00:00.000Z"
title: "auth"
---

body
`,
      "utf8",
    );

    // Simulate Cursor user-level hook cwd (~/.cursor) — unrelated to the linked repo.
    const unrelatedCwd = path.join(env.home, ".cursor");
    await mkdir(unrelatedCwd, { recursive: true });

    const result = runCli(["handoff", "peek"], withGroundedHome(env.home), unrelatedCwd, {
      input: JSON.stringify({ workspace_roots: [env.repo] }),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      '[grounder] Latest handoff: "auth" (2026-06-26). Run /grounder-task to load it, or ignore if unrelated.\n',
    );
  });

  it("cli finds linked repo via CURSOR_PROJECT_DIR when stdin has no workspace", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(
      path.join(logsDir, "2026-06-26-150000-auth.md"),
      `---
created: "2026-06-26T15:00:00.000Z"
title: "auth"
---

body
`,
      "utf8",
    );

    const unrelatedCwd = path.join(env.home, ".cursor");
    await mkdir(unrelatedCwd, { recursive: true });

    const result = runCli(
      ["handoff", "peek"],
      { ...withGroundedHome(env.home), CURSOR_PROJECT_DIR: env.repo },
      unrelatedCwd,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      '[grounder] Latest handoff: "auth" (2026-06-26). Run /grounder-task to load it, or ignore if unrelated.\n',
    );
  });

  it("--json prints additional_context when a teaser is present", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await writeFile(
      path.join(logsDir, "2026-06-26-150000-auth.md"),
      `---
project: "my-app"
created: "2026-06-26T15:00:00.000Z"
title: "auth"
---

# Handoff
`,
      "utf8",
    );

    const { code, out } = await captureStdout(() =>
      runHandoffPeekWithOptions({ cwd: env.repo, homeDir: env.home, json: true }),
    );

    expect(code).toBe(0);
    expect(out.endsWith("\n")).toBe(true);
    expect(JSON.parse(out)).toEqual({
      additional_context:
        '[grounder] Latest handoff: "auth" (2026-06-26). Run /grounder-task to load it, or ignore if unrelated.',
    });
  });

  it("--json prints {} when unlinked", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    const { code, out } = await captureStdout(() =>
      runHandoffPeekWithOptions({ cwd: env.repo, homeDir: env.home, json: true }),
    );

    expect(code).toBe(0);
    expect(out).toBe("{}\n");
  });

  it("--json prints {} when linked with no handoffs", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runHandoffPeekWithOptions({ cwd: env.repo, homeDir: env.home, json: true }),
    );

    expect(code).toBe(0);
    expect(out).toBe("{}\n");
  });

  it("cli --json prints additional_context JSON", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(
      path.join(logsDir, "2026-06-26-150000-auth.md"),
      `---
created: "2026-06-26T15:00:00.000Z"
title: "auth"
---

body
`,
      "utf8",
    );

    const result = runCli(["handoff", "peek", "--json"], withGroundedHome(env.home), env.repo);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      additional_context:
        '[grounder] Latest handoff: "auth" (2026-06-26). Run /grounder-task to load it, or ignore if unrelated.',
    });
  });

  it("appends migrate nudge when install is outdated", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    // Agent present in the ledger, but no file hashes recorded — every
    // desired skill file counts as drift (a newly-added skill would surface
    // the same way).
    const state = await readGrounderState(env.home);
    if (!state) {
      throw new Error("expected install state after setup");
    }
    await writeGrounderState(
      { ...state, agents: { ...state.agents, cursor: { files: {} } } },
      env.home,
    );

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await writeFile(
      path.join(logsDir, "2026-06-26-150000-auth.md"),
      `---
created: "2026-06-26T15:00:00.000Z"
title: "auth"
---

body
`,
      "utf8",
    );

    const { code, out } = await captureStdout(() =>
      runHandoffPeekWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe(
      '[grounder] Latest handoff: "auth" (2026-06-26). Run /grounder-task to load it, or ignore if unrelated.\n[grounder] Install outdated — run: grounder migrate.\n',
    );
  });

  it("prints migrate-only teaser when install is outdated and there is no handoff", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    const state = await readGrounderState(env.home);
    if (!state) {
      throw new Error("expected install state after setup");
    }
    await writeGrounderState(
      { ...state, agents: { ...state.agents, cursor: { files: {} } } },
      env.home,
    );

    const { code, out } = await captureStdout(() =>
      runHandoffPeekWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe("[grounder] Install outdated — run: grounder migrate.\n");
  });

  it("stays silent on a stale grounderVersion alone — install-content drift only, by design", async () => {
    // docs/architecture/state-reconciliation.md: package version and install
    // content are separate checks — peek must not nag "run migrate" for a
    // plain package bump; that can also mean "upgrade Grounder", which is
    // the CLI banner's job, not peek's.
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    // File hashes still match current templates (see agents/cursor.ts) so
    // only grounderVersion is stale.
    const state = await readGrounderState(env.home);
    if (!state) {
      throw new Error("expected install state after setup");
    }
    await writeGrounderState({ ...state, grounderVersion: "0.0.1" }, env.home);

    const { code, out } = await captureStdout(() =>
      runHandoffPeekWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe("");
  });

  it("collapses embedded newlines/whitespace in the title to single spaces", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await mkdir(logsDir, { recursive: true });
    // `\n` here is the YAML double-quoted escape (two literal chars in the
    // file) that parseHandoffFrontmatter unescapes into a real newline —
    // exercising the same "control char embedded in title" case sanitizeLabel
    // guards against.
    await writeFile(
      path.join(logsDir, "2026-06-26-150000-auth.md"),
      `---
created: "2026-06-26T15:00:00.000Z"
title: "auth   fix\\nfor login"
---

body
`,
      "utf8",
    );

    const { code, out } = await captureStdout(() =>
      runHandoffPeekWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe(
      '[grounder] Latest handoff: "auth fix for login" (2026-06-26). Run /grounder-task to load it, or ignore if unrelated.\n',
    );
  });

  it("truncates an unusually long title with an ellipsis", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    await mkdir(logsDir, { recursive: true });
    const longTitle = "x".repeat(200);
    await writeFile(
      path.join(logsDir, "2026-06-26-150000-auth.md"),
      `---
created: "2026-06-26T15:00:00.000Z"
title: "${longTitle}"
---

body
`,
      "utf8",
    );

    const { code, out } = await captureStdout(() =>
      runHandoffPeekWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    const expectedLabel = `${"x".repeat(79)}…`;
    expect(out).toBe(
      `[grounder] Latest handoff: "${expectedLabel}" (2026-06-26). Run /grounder-task to load it, or ignore if unrelated.\n`,
    );
  });
});
