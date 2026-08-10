import { spawnSync } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPlan, runPlanWithOptions } from "../../src/commands/plan.js";
import { runRepoInitWithOptions } from "../../src/commands/repo/init.js";
import { runVaultInitWithOptions } from "../../src/commands/vault/init.js";
import { captureStdout, createTempEnv, withGroundedHome } from "../helpers.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(pkgRoot, "dist", "cli.js");

function runCli(args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, cwd });
}

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

const planBody = `# Goal

Ship plan capture.

## Steps
1. CLI command
`;

describe("commands/plan", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("writes plan end-to-end with frontmatter", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const fixedTime = new Date("2026-06-26T14:30:00.000Z");
    const { code, out } = await captureStdout(() =>
      runPlanWithOptions({
        cwd: env.repo,
        text: planBody,
        title: "phase-1",
        homeDir: env.home,
        now: fixedTime,
      }),
    );

    expect(code).toBe(0);
    const planPath = path.join(env.vault, "10-Projects", "my-app", "plans", "phase-1.md");
    expect(out).toBe(`Wrote ${planPath}\n`);
    const content = await readFile(planPath, "utf8");
    expect(content).toContain('project: "my-app"\n');
    expect(content).toContain(`created: "${fixedTime.toISOString()}"\n`);
    expect(content).not.toContain("updated:");
    expect(content.endsWith(planBody)).toBe(true);
  });

  it("sanitizes title (uppercase, spaces, trailing .md)", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runPlanWithOptions({
        cwd: env.repo,
        text: planBody,
        title: "Phase One.md",
        homeDir: env.home,
      }),
    );

    expect(code).toBe(0);
    expect(out).toContain("/plans/phase-one.md");
  });

  it("refuses overwrite without --force and leaves file untouched", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const planPath = path.join(env.vault, "10-Projects", "my-app", "plans", "phase-1.md");
    await runPlanWithOptions({
      cwd: env.repo,
      text: planBody,
      title: "phase-1",
      homeDir: env.home,
    });
    const original = await readFile(planPath, "utf8");

    const { code, err } = await captureStderr(() =>
      runPlanWithOptions({
        cwd: env.repo,
        text: "# overwritten\n",
        title: "phase-1",
        homeDir: env.home,
      }),
    );

    expect(code).toBe(1);
    expect(err).toContain(`Plan already exists: ${planPath}`);
    expect(err).toContain("Use --force to overwrite.");
    expect(await readFile(planPath, "utf8")).toBe(original);
  });

  it("overwrites with --force, preserves created, prints Updated", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const createdAt = new Date("2026-06-26T14:30:00.000Z");
    const updatedAt = new Date("2026-07-01T10:00:00.000Z");
    const planPath = path.join(env.vault, "10-Projects", "my-app", "plans", "phase-1.md");

    await runPlanWithOptions({
      cwd: env.repo,
      text: planBody,
      title: "phase-1",
      homeDir: env.home,
      now: createdAt,
    });

    const newBody = "# Updated goal\n";
    const { code, out } = await captureStdout(() =>
      runPlanWithOptions({
        cwd: env.repo,
        text: newBody,
        title: "phase-1",
        force: true,
        homeDir: env.home,
        now: updatedAt,
      }),
    );

    expect(code).toBe(0);
    expect(out).toBe(`Updated ${planPath}\n`);
    const content = await readFile(planPath, "utf8");
    expect(content).toContain(`created: "${createdAt.toISOString()}"\n`);
    expect(content).toContain(`updated: "${updatedAt.toISOString()}"\n`);
    expect(content.endsWith(newBody)).toBe(true);
  });

  it("finds link walking up from a nested cwd", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const nested = path.join(env.repo, "src", "nested");
    await mkdir(nested, { recursive: true });

    const { code, out } = await captureStdout(() =>
      runPlanWithOptions({
        cwd: nested,
        text: planBody,
        title: "from-nested",
        homeDir: env.home,
      }),
    );

    expect(code).toBe(0);
    expect(out).toContain("/plans/from-nested.md");
  });

  it("returns usage error when text is missing", async () => {
    const { code, err } = await captureStderr(() => runPlan([]));
    expect(code).toBe(1);
    expect(err).toContain("Usage: grounder plan <text> --title <name>");
    expect(err).toContain("--path <file>");
  });

  it("returns usage error when --title and --path are both missing", async () => {
    const { code, err } = await captureStderr(() =>
      runPlanWithOptions({ text: planBody, homeDir: "/tmp/unused-grounder-home" }),
    );
    expect(code).toBe(1);
    expect(err).toContain("Usage: grounder plan <text> --title <name>");
    expect(err).toContain("--path <file>");
  });

  it("returns usage error when --title sanitizes to empty", async () => {
    const { code, err } = await captureStderr(() =>
      runPlanWithOptions({
        text: planBody,
        title: "!!!",
        homeDir: "/tmp/unused-grounder-home",
      }),
    );
    expect(code).toBe(1);
    expect(err).toContain("Usage: grounder plan <text> --title <name>");
  });

  it("rejects --title and --path together", async () => {
    const { code, err } = await captureStderr(() =>
      runPlanWithOptions({
        text: planBody,
        title: "phase-1",
        planPath: "/tmp/plan.md",
        homeDir: "/tmp/unused-grounder-home",
      }),
    );
    expect(code).toBe(1);
    expect(err).toContain("Use either --title or --path, not both.");
  });

  it("rejects --force with --path", async () => {
    const { code, err } = await captureStderr(() =>
      runPlanWithOptions({
        text: planBody,
        planPath: "/tmp/plan.md",
        force: true,
        homeDir: "/tmp/unused-grounder-home",
      }),
    );
    expect(code).toBe(1);
    expect(err).toContain("--force is not used with --path");
  });

  it("updates an existing plan by --path without sanitizing the filename", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const plansDir = path.join(env.vault, "10-Projects", "my-app", "plans");
    const spacedPath = path.join(plansDir, "document 1.md");
    const createdAt = new Date("2026-06-26T14:30:00.000Z");
    const updatedAt = new Date("2026-07-01T10:00:00.000Z");
    await writeFile(
      spacedPath,
      [
        "---",
        'project: "my-app"',
        `created: "${createdAt.toISOString()}"`,
        "---",
        "",
        "# old\n",
      ].join("\n"),
      "utf8",
    );

    const newBody = "# new conclusions\n";
    const { code, out } = await captureStdout(() =>
      runPlanWithOptions({
        cwd: env.repo,
        text: newBody,
        planPath: spacedPath,
        homeDir: env.home,
        now: updatedAt,
      }),
    );

    expect(code).toBe(0);
    expect(out).toBe(`Updated ${spacedPath}\n`);
    const content = await readFile(spacedPath, "utf8");
    expect(content).toContain(`created: "${createdAt.toISOString()}"\n`);
    expect(content).toContain(`updated: "${updatedAt.toISOString()}"\n`);
    expect(content.endsWith(newBody)).toBe(true);
    await expect(readFile(path.join(plansDir, "document-1.md"), "utf8")).rejects.toThrow();
  });

  it("rejects --path outside this project's plans/", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const outside = path.join(env.vault, "10-Projects", "my-app", "notes", "sneaky.md");
    await mkdir(path.dirname(outside), { recursive: true });
    await writeFile(outside, "# no\n", "utf8");

    const plansDir = path.join(env.vault, "10-Projects", "my-app", "plans");
    const { code, err } = await captureStderr(() =>
      runPlanWithOptions({
        cwd: env.repo,
        text: planBody,
        planPath: outside,
        homeDir: env.home,
      }),
    );

    expect(code).toBe(1);
    expect(err).toContain("Plan path must resolve inside this project's plans directory:");
    expect(err).toContain(plansDir);
    expect(err).toContain(outside);
  });

  it("rejects --path that is a symlink pointing outside plans/", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const plansDir = path.join(env.vault, "10-Projects", "my-app", "plans");
    const outside = path.join(env.home, "outside-secret.md");
    await writeFile(outside, "# keep me\n", "utf8");
    const linkPath = path.join(plansDir, "escape.md");
    await symlink(outside, linkPath);

    const { code, err } = await captureStderr(() =>
      runPlanWithOptions({
        cwd: env.repo,
        text: planBody,
        planPath: linkPath,
        homeDir: env.home,
      }),
    );

    expect(code).toBe(1);
    expect(err).toContain("Plan path must resolve inside this project's plans directory:");
    expect(err).toContain(linkPath);
    expect(await readFile(outside, "utf8")).toBe("# keep me\n");
  });

  it("rejects nonexistent --path under plans/", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const missing = path.join(env.vault, "10-Projects", "my-app", "plans", "missing.md");
    const { code, err } = await captureStderr(() =>
      runPlanWithOptions({
        cwd: env.repo,
        text: planBody,
        planPath: missing,
        homeDir: env.home,
      }),
    );

    expect(code).toBe(1);
    expect(err).toContain(`Plan not found: ${missing}`);
  });

  it("rejects --path that is not a .md file", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const plansDir = path.join(env.vault, "10-Projects", "my-app", "plans");
    const notMd = path.join(plansDir, "notes.txt");
    await writeFile(notMd, "x", "utf8");

    const { code, err } = await captureStderr(() =>
      runPlanWithOptions({
        cwd: env.repo,
        text: planBody,
        planPath: notMd,
        homeDir: env.home,
      }),
    );

    expect(code).toBe(1);
    expect(err).toContain("Plan path must be a .md file under plans/:");
    expect(err).toContain(notMd);
  });

  it("updates via relative --path resolved from cwd", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const plansDir = path.join(env.vault, "10-Projects", "my-app", "plans");
    const spacedPath = path.join(plansDir, "document 1.md");
    await writeFile(
      spacedPath,
      [
        "---",
        'project: "my-app"',
        'created: "2026-06-26T14:30:00.000Z"',
        "---",
        "",
        "# old\n",
      ].join("\n"),
      "utf8",
    );

    const relativePath = path.relative(env.repo, spacedPath);
    expect(path.isAbsolute(relativePath)).toBe(false);

    const { code, out } = await captureStdout(() =>
      runPlanWithOptions({
        cwd: env.repo,
        text: "# relative update\n",
        planPath: relativePath,
        homeDir: env.home,
      }),
    );

    expect(code).toBe(0);
    expect(out).toBe(`Updated ${spacedPath}\n`);
    expect(await readFile(spacedPath, "utf8")).toContain("# relative update");
  });

  it("cli updates via --path", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const spacedPath = path.join(env.vault, "10-Projects", "my-app", "plans", "document 1.md");
    await writeFile(
      spacedPath,
      [
        "---",
        'project: "my-app"',
        'created: "2026-06-26T14:30:00.000Z"',
        "---",
        "",
        "# old\n",
      ].join("\n"),
      "utf8",
    );

    const result = runCli(
      ["plan", "# Updated\n", "--path", spacedPath],
      withGroundedHome(env.home),
      env.repo,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Updated ${spacedPath}`);
    expect(await readFile(spacedPath, "utf8")).toContain("# Updated");
  });

  it("returns standard stderr hint when unlinked", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });

    const { code, err } = await captureStderr(() =>
      runPlanWithOptions({
        cwd: env.repo,
        text: planBody,
        title: "phase-1",
        homeDir: env.home,
      }),
    );

    expect(code).toBe(1);
    expect(err).toContain("Folder not linked. Run: grounder init");
  });

  it("cli prints written path", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const result = runCli(
      ["plan", "# Goal\n\nShip it", "--title", "phase-1"],
      withGroundedHome(env.home),
      env.repo,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Wrote ");
    expect(result.stdout).toContain("/plans/phase-1.md");
  });

  it("cli accepts a body that starts with YAML frontmatter ---", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const body = "---\nextra: true\n---\n\n# Goal\n\nShip it";
    const result = runCli(
      ["plan", body, "--title", "frontmatter-body"],
      withGroundedHome(env.home),
      env.repo,
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("/plans/frontmatter-body.md");
    const planPath = path.join(env.vault, "10-Projects", "my-app", "plans", "frontmatter-body.md");
    const content = await readFile(planPath, "utf8");
    expect(content).toContain("extra: true");
    expect(content).toContain("# Goal");
    expect(content).toContain("Ship it");
  });

  it("cli refuses overwrite without --force", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    runCli(["plan", planBody, "--title", "phase-1"], withGroundedHome(env.home), env.repo);
    const result = runCli(
      ["plan", "# overwrite", "--title", "phase-1"],
      withGroundedHome(env.home),
      env.repo,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Plan already exists:");
    expect(result.stderr).toContain("Use --force to overwrite.");
  });

  it("cli overwrites with --force", async () => {
    const env = await createTempEnv({ packageName: "my-app" });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    await runRepoInitWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    runCli(["plan", planBody, "--title", "phase-1"], withGroundedHome(env.home), env.repo);
    const result = runCli(
      ["plan", "# Updated\n", "--title", "phase-1", "--force"],
      withGroundedHome(env.home),
      env.repo,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Updated ");
    expect(result.stdout).toContain("/plans/phase-1.md");
  });
});
