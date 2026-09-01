import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runStatuslineWithOptions } from "../../src/agents/claude-statusline.js";
import { runLinkWithOptions } from "../../src/commands/link.js";
import { runSetupWithOptions } from "../../src/commands/setup.js";
import { writeGrounderState } from "../../src/connector/state.js";
import { captureStdout, createTempEnv, withGroundedHome } from "../helpers.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(pkgRoot, "dist", "cli.js");

function runCli(env: NodeJS.ProcessEnv, cwd?: string, input?: string) {
  return spawnSync(process.execPath, [cli, "statusline"], {
    encoding: "utf8",
    env,
    cwd,
    input,
  });
}

describe("agents/claude-statusline", () => {
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
      runStatuslineWithOptions({ cwd: env.repo, homeDir: env.home }),
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
      runStatuslineWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe("");
  });

  it("prints one-line status for the newest handoff", async () => {
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
      runStatuslineWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe('[grounder] handoff: "auth" (2026-06-26) → /grounder-task\n');
  });

  it("cli reads workspace.current_dir from stdin JSON", async () => {
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

    // cwd elsewhere (e.g. Claude Code's own working dir) — workspace.current_dir wins.
    const elsewhere = path.join(env.home, "elsewhere");
    await mkdir(elsewhere, { recursive: true });

    const result = runCli(
      withGroundedHome(env.home),
      elsewhere,
      JSON.stringify({ cwd: elsewhere, workspace: { current_dir: env.repo } }),
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('[grounder] handoff: "auth" (2026-06-26) → /grounder-task\n');
  });

  it("cli falls back to top-level cwd when workspace.current_dir is absent", async () => {
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

    const result = runCli(withGroundedHome(env.home), undefined, JSON.stringify({ cwd: env.repo }));

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('[grounder] handoff: "auth" (2026-06-26) → /grounder-task\n');
  });

  it("cli peeks silently when unlinked", () => {
    const result = runCli(withGroundedHome("/tmp/grounder-no-home-statusline"));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("prints migrate-only status when schemas are stale and there is no handoff", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    await writeGrounderState(
      {
        grounderVersion: "0.2.0",
        agents: { cursor: { commandsSchema: 0, files: {} } },
      },
      env.home,
    );

    const { code, out } = await captureStdout(() =>
      runStatuslineWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe("[grounder] install outdated — run: grounder migrate\n");
  });

  it("shows the handoff line once per session id, then suppresses it", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

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

    const first = await captureStdout(() =>
      runStatuslineWithOptions({ cwd: env.repo, homeDir: env.home, sessionId: "session-a" }),
    );
    const second = await captureStdout(() =>
      runStatuslineWithOptions({ cwd: env.repo, homeDir: env.home, sessionId: "session-a" }),
    );

    expect(first.out).toBe('[grounder] handoff: "auth" (2026-06-26) → /grounder-task\n');
    expect(second.out).toBe("");
  });

  it("shows the handoff line again for a different session id", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

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

    await runStatuslineWithOptions({ cwd: env.repo, homeDir: env.home, sessionId: "session-a" });
    const other = await captureStdout(() =>
      runStatuslineWithOptions({ cwd: env.repo, homeDir: env.home, sessionId: "session-b" }),
    );

    expect(other.out).toBe('[grounder] handoff: "auth" (2026-06-26) → /grounder-task\n');
  });

  it("keeps showing the migrate notice on every render even after the handoff line is suppressed", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    await writeGrounderState(
      {
        grounderVersion: "0.2.0",
        agents: { cursor: { commandsSchema: 0, hooksSchema: 0, files: {} } },
      },
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

    const first = await captureStdout(() =>
      runStatuslineWithOptions({ cwd: env.repo, homeDir: env.home, sessionId: "session-a" }),
    );
    const second = await captureStdout(() =>
      runStatuslineWithOptions({ cwd: env.repo, homeDir: env.home, sessionId: "session-a" }),
    );

    expect(first.out).toBe(
      '[grounder] handoff: "auth" (2026-06-26) → /grounder-task · [grounder] install outdated — run: grounder migrate\n',
    );
    expect(second.out).toBe("[grounder] install outdated — run: grounder migrate\n");
  });

  it("without a session id, always shows the handoff line (no suppression)", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

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

    const first = await captureStdout(() =>
      runStatuslineWithOptions({ cwd: env.repo, homeDir: env.home }),
    );
    const second = await captureStdout(() =>
      runStatuslineWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(first.out).toBe('[grounder] handoff: "auth" (2026-06-26) → /grounder-task\n');
    expect(second.out).toBe('[grounder] handoff: "auth" (2026-06-26) → /grounder-task\n');
  });

  it("cli reads session_id from stdin JSON and suppresses on the second call", async () => {
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

    const input = JSON.stringify({ cwd: env.repo, session_id: "cli-session-a" });
    const first = runCli(withGroundedHome(env.home), env.repo, input);
    const second = runCli(withGroundedHome(env.home), env.repo, input);

    expect(first.stdout).toBe('[grounder] handoff: "auth" (2026-06-26) → /grounder-task\n');
    expect(second.stdout).toBe("");
  });

  it("combines the handoff line and the migrate notice when both apply", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    await writeGrounderState(
      {
        grounderVersion: "0.2.0",
        agents: { cursor: { commandsSchema: 0, hooksSchema: 0, files: {} } },
      },
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
      runStatuslineWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe(
      '[grounder] handoff: "auth" (2026-06-26) → /grounder-task · [grounder] install outdated — run: grounder migrate\n',
    );
  });

  it("stays silent on a stale grounderVersion alone (schemas current) — schema-only, same as peek", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runSetupWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });
    // Schemas match current (see agents/cursor.ts) so only grounderVersion is stale.
    await writeGrounderState(
      {
        grounderVersion: "0.0.1",
        agents: { cursor: { commandsSchema: 3, hooksSchema: 1, files: {} } },
      },
      env.home,
    );

    const { code, out } = await captureStdout(() =>
      runStatuslineWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe("");
  });
});
