import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runHandoffWithOptions } from "../../src/commands/handoff.js";
import { runRepoInitWithOptions } from "../../src/commands/repo/init.js";
import { runVaultInitWithOptions } from "../../src/commands/vault/init.js";
import { currentBranch } from "../../src/connector/git.js";
import { createTempEnv, withGroundedHome } from "../helpers.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(pkgRoot, "dist", "cli.js");

function runCli(args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, cwd });
}

const handoffBody = `# Handoff: auth

## Done
- Wired middleware

## Next
1. Add tests
`;

describe("commands/handoff", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("writes handoff end-to-end with frontmatter", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const fixedTime = new Date("2026-06-26T14:30:00");
    const code = await runHandoffWithOptions({
      cwd: env.repo,
      text: handoffBody,
      title: "auth",
      homeDir: env.home,
      now: fixedTime,
    });

    expect(code).toBe(0);
    const handoffPath = path.join(
      env.vault,
      "10-Projects",
      "my-app",
      "logs",
      "2026-06-26-1430-auth.md",
    );
    const content = await readFile(handoffPath, "utf8");
    expect(content).toContain("project: my-app\n");
    expect(content).toContain(`created: ${fixedTime.toISOString()}\n`);
    expect(content).toContain("title: auth\n");
    expect(content.endsWith(handoffBody)).toBe(true);

    const branch = await currentBranch(env.repo);
    if (branch) {
      expect(content).toContain(`branch: ${branch}\n`);
    } else {
      expect(content).not.toContain("branch:");
    }
  });

  it("cli prints written path", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const result = runCli(
      ["handoff", "# Handoff\n\n## Next\n1. ship it", "--title", "session"],
      withGroundedHome(env.home),
      env.repo,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Wrote ");
    expect(result.stdout).toMatch(/\d{4}-\d{2}-\d{2}-\d{4}-session\.md/);
  });

  it("finds link walking up from a nested cwd", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const nested = path.join(env.repo, "src", "nested");
    await mkdir(nested, { recursive: true });

    const code = await runHandoffWithOptions({
      cwd: nested,
      text: handoffBody,
      title: "from-nested",
      homeDir: env.home,
    });

    expect(code).toBe(0);
    const logsDir = path.join(env.vault, "10-Projects", "my-app", "logs");
    const files = await readdir(logsDir);
    expect(files.some((file) => file.includes("from-nested"))).toBe(true);
  });

  it("returns usage error when text is missing", async () => {
    const result = runCli(["handoff"], withGroundedHome("/tmp/unused-grounder-home"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: grounder handoff <text>");
  });
});
