import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claude, claudeSettingsJsonPath } from "../../src/agents/claude.js";
import {
  cursor,
  grounderTaskHandoffCommandPath as cursorHandoffCommandPath,
  cursorHooksJsonPath,
  grounderNoteCommandPath as cursorNoteCommandPath,
  grounderPlanCommandPath as cursorPlanCommandPath,
  grounderTaskCommandPath as cursorTaskCommandPath,
} from "../../src/agents/cursor.js";
import { hookFileGrounderPeekCommands, runtimeInvocation } from "../../src/agents/hook-runtime.js";
import { createTempEnv, type TempEnv, withGroundedHome } from "../helpers.js";

/**
 * Behavioral e2e: drives `setup` + `link` through the real built CLI
 * (subprocess, temp HOME/vault/repo — same shape as `test/cli.test.ts`), then
 * executes the exact runtime-prefixed shell strings baked into the installed
 * command files and hook configs, exactly as Cursor/Claude would run them
 * (raw shell string, no internal function calls). Proves the full pipeline —
 * "commands visible, do not throw" — without a live agent or LLM.
 *
 * Split into ordered `it`s (init happens once in `beforeAll`) so a mid-flow
 * failure — artifacts missing vs. a bad render vs. a broken invocation vs. a
 * broken hook — is obvious from which test failed, not just which assertion.
 */

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(pkgRoot, "dist", "cli.js");

function runCli(args: string[], env: NodeJS.ProcessEnv, cwd: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, cwd });
}

/** Runs `command` through a real shell — mirrors how Cursor/Claude invoke hook/command strings. */
function runShell(
  command: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
  options?: { input?: string },
): SpawnSyncReturns<string> {
  return spawnSync(command, { encoding: "utf8", env, cwd, shell: true, input: options?.input });
}

function assertOk(result: SpawnSyncReturns<string>, label: string): void {
  expect(
    result.status,
    `${label} failed (status ${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  ).toBe(0);
}

/**
 * Slice the exact invocation embedded in an installed command file: find
 * `afterPrefix` (verbatim template text, including any `<placeholder>`
 * tokens) in `content`, assert it is immediately preceded by the canonical
 * runtime invocation (byte-for-byte — not merely "no `{{GROUNDER_CLI}}` left
 * over"), then substitute the documented placeholders with concrete test
 * values.
 *
 * The returned string is a substring of the *installed file's own bytes*
 * (only placeholders are swapped) — a broken `{{GROUNDER_CLI}}` substitution
 * (bad quoting, wrong path, extra escaping) fails the `expect` below instead
 * of being masked by a separately-computed `runtimeInvocation()` call.
 */
function renderedInvocation(
  content: string,
  homeDir: string,
  afterPrefix: string,
  substitutions: Record<string, string> = {},
): string {
  const idx = content.indexOf(afterPrefix);
  if (idx === -1) {
    throw new Error(`documented invocation not found in installed file: ${afterPrefix}`);
  }
  const prefix = runtimeInvocation(homeDir);
  const start = Math.max(idx - prefix.length - 1, 0);
  expect(
    content.slice(start, idx),
    `rendered prefix immediately before "${afterPrefix}" should be the canonical runtime invocation`,
  ).toBe(`${prefix} `);

  let command = content.slice(start, idx + afterPrefix.length);
  for (const [placeholder, value] of Object.entries(substitutions)) {
    command = command.split(placeholder).join(value);
  }
  return command;
}

function allExpectedArtifacts(homeDir: string): string[] {
  return [...cursor.expectedArtifacts(homeDir), ...claude.expectedArtifacts(homeDir)];
}

describe("e2e/agent-pipeline", () => {
  let env: TempEnv;
  let grounded: NodeJS.ProcessEnv;
  let planPath = "";

  beforeAll(async () => {
    env = await createTempEnv({ packageName: "e2e-demo-app" });
    grounded = withGroundedHome(env.home);

    const setupResult = runCli(
      ["setup", env.vault, "--agent", "cursor", "--agent", "claude", "--hooks", "--yes"],
      grounded,
      env.repo,
    );
    assertOk(setupResult, "setup");

    const linkResult = runCli(["link", "--yes"], grounded, env.repo);
    assertOk(linkResult, "link");
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  it("installs real files at every path each adapter promises", async () => {
    for (const artifactPath of allExpectedArtifacts(env.home)) {
      await expect(access(artifactPath)).resolves.toBeUndefined();
    }
  });

  it("fully renders every command file — no leftover placeholder, real runtime invocation", async () => {
    const runtime = runtimeInvocation(env.home);
    for (const artifactPath of allExpectedArtifacts(env.home)) {
      const content = await readFile(artifactPath, "utf8");
      expect(content).not.toContain("{{GROUNDER_CLI}}");
      expect(content).toContain(runtime);
    }
  });

  it("runs every documented invocation straight from the installed markdown, without throwing", async () => {
    const noteContent = await readFile(cursorNoteCommandPath(env.home), "utf8");
    const note = runShell(
      renderedInvocation(noteContent, env.home, 'note --title <slug> "<body>"', {
        "<slug>": "e2e-smoke-note",
        "<body>": "e2e smoke note",
      }),
      grounded,
      env.repo,
    );
    assertOk(note, "note");
    expect(note.stdout).toMatch(/^Wrote .*e2e-smoke-note\.md\n$/);

    const noteList = runShell(
      renderedInvocation(noteContent, env.home, "note list --limit <N>", { "<N>": "5" }),
      grounded,
      env.repo,
    );
    assertOk(noteList, "note list");
    expect(noteList.stdout).toContain("e2e-smoke-note");

    const handoffWriteContent = await readFile(cursorHandoffCommandPath(env.home), "utf8");
    const handoff = runShell(
      renderedInvocation(handoffWriteContent, env.home, 'handoff --title <slug> "<body>"', {
        "<slug>": "e2e-smoke-handoff",
        "<body>": "# Handoff: e2e",
      }),
      grounded,
      env.repo,
    );
    assertOk(handoff, "handoff");
    expect(handoff.stdout).toMatch(/^Wrote .*e2e-smoke-handoff\.md\n$/);

    const taskContent = await readFile(cursorTaskCommandPath(env.home), "utf8");
    const handoffHead = runShell(
      renderedInvocation(taskContent, env.home, "handoff list --head"),
      grounded,
      env.repo,
    );
    assertOk(handoffHead, "handoff list --head");
    expect(handoffHead.stdout.trim()).toMatch(/e2e-smoke-handoff\.md$/);

    const handoffList = runShell(
      renderedInvocation(taskContent, env.home, "handoff list --limit 5"),
      grounded,
      env.repo,
    );
    assertOk(handoffList, "handoff list --limit");
    expect(handoffList.stdout).toContain("e2e-smoke-handoff");

    const planContent = await readFile(cursorPlanCommandPath(env.home), "utf8");
    const plan = runShell(
      renderedInvocation(
        planContent,
        env.home,
        `plan "$(cat <<'EOF'\n# Plan: …\n…\nEOF\n)" --title <name>`,
        { "<name>": "e2e-smoke-plan" },
      ),
      grounded,
      env.repo,
    );
    assertOk(plan, "plan --title");
    const planPathMatch = /^Wrote (.*e2e-smoke-plan\.md)\n$/.exec(plan.stdout);
    expect(planPathMatch, `unexpected plan stdout: ${plan.stdout}`).not.toBeNull();
    planPath = planPathMatch?.[1] ?? "";

    const planUpdate = runShell(
      renderedInvocation(
        planContent,
        env.home,
        `plan "$(cat <<'EOF'\n# Plan: …\n…\nEOF\n)" --path <path>`,
        { "<path>": JSON.stringify(planPath) },
      ),
      grounded,
      env.repo,
    );
    assertOk(planUpdate, "plan --path");
    expect(planUpdate.stdout).toBe(`Updated ${planPath}\n`);

    const planList = runShell(
      renderedInvocation(planContent, env.home, "plan list --limit 5"),
      grounded,
      env.repo,
    );
    assertOk(planList, "plan list");
    expect(planList.stdout).toContain("e2e-smoke-plan");
  });

  it("runs the session-start hooks exactly as each host app invokes them", async () => {
    // --- Claude: SessionStart hooks run with the project as cwd. -----------
    const claudeHookCommands = await hookFileGrounderPeekCommands(claudeSettingsJsonPath(env.home));
    expect(claudeHookCommands).toHaveLength(1);
    const claudeHook = runShell(claudeHookCommands[0], grounded, env.repo);
    assertOk(claudeHook, "claude SessionStart hook");
    expect(claudeHook.stdout).toContain('"e2e-smoke-handoff"');

    // --- Cursor: user-level hooks *can* run with the project as cwd (e.g. a
    // single-root workspace opened directly) — this covers that shape. ------
    const cursorHookCommands = await hookFileGrounderPeekCommands(cursorHooksJsonPath(env.home));
    expect(cursorHookCommands).toHaveLength(1);
    const cursorHookViaCwd = runShell(cursorHookCommands[0], grounded, env.repo);
    assertOk(cursorHookViaCwd, "cursor sessionStart hook (project cwd)");
    expect(JSON.parse(cursorHookViaCwd.stdout)).toEqual({
      additional_context: expect.stringContaining('"e2e-smoke-handoff"'),
    });

    // --- Cursor: user-level hooks commonly run with cwd under ~/.cursor, not
    // the open project — that's why peek reads stdin `workspace_roots` first.
    // Regressing to `process.cwd()`-only resolution would still pass every
    // other assertion in this file; only this shape catches it. ------------
    const cursorHookViaStdin = runShell(
      cursorHookCommands[0],
      grounded,
      path.join(env.home, ".cursor"),
      { input: JSON.stringify({ workspace_roots: [env.repo] }) },
    );
    assertOk(
      cursorHookViaStdin,
      "cursor sessionStart hook (~/.cursor cwd + stdin workspace_roots)",
    );
    expect(JSON.parse(cursorHookViaStdin.stdout)).toEqual({
      additional_context: expect.stringContaining('"e2e-smoke-handoff"'),
    });
  });
});
