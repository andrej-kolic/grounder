import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  labelFromHandoffFilename,
  runHandoffPeekWithOptions,
} from "../../../src/commands/handoff/peek.js";
import { runRepoInitWithOptions } from "../../../src/commands/repo/init.js";
import { runVaultInitWithOptions } from "../../../src/commands/vault/init.js";
import { captureStdout, createTempEnv, withGroundedHome } from "../../helpers.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = path.join(pkgRoot, "dist", "cli.js");

function runCli(args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, cwd });
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

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runHandoffPeekWithOptions({ cwd: env.repo, homeDir: env.home }),
    );

    expect(code).toBe(0);
    expect(out).toBe("");
  });

  it("prints one-line teaser for the newest handoff", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

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

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

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

  it("reads unquoted legacy frontmatter and minute-precision filenames", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

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

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

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
});
