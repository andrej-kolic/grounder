import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { updatePlanAtPath, writePlan } from "../../src/vault/write-plan.js";
import { createTempEnv } from "../helpers.js";

describe("vault/write-plan", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  const createdAt = new Date("2026-06-26T14:30:00.000Z");
  const updatedAt = new Date("2026-07-01T10:00:00.000Z");
  const body = `# Goal

Ship plan capture.

## Steps
1. Vault layer
`;

  it("creates a plan with project and created frontmatter", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");

    const result = await writePlan(plansDir, "phase-1", body, {
      projectId: "my-app",
      now: createdAt,
    });

    expect(result).toEqual({
      path: path.join(plansDir, "phase-1.md"),
      status: "created",
    });
    expect(await readFile(result.path, "utf8")).toBe(
      ["---", 'project: "my-app"', `created: "${createdAt.toISOString()}"`, "---", "", body].join(
        "\n",
      ),
    );
  });

  it("includes topics in frontmatter when provided", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");

    const result = await writePlan(plansDir, "with-topics", body, {
      projectId: "my-app",
      topics: ["caching", "redis"],
      now: createdAt,
    });

    expect(result.status).toBe("created");
    const content = await readFile(result.path, "utf8");
    expect(content).toContain('topics: ["caching", "redis"]\n');
  });

  it("preserves topics through force overwrite", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");

    await writePlan(plansDir, "evolving", body, {
      projectId: "my-app",
      topics: ["old"],
      now: createdAt,
    });

    const result = await writePlan(plansDir, "evolving", "# new\n", {
      projectId: "my-app",
      force: true,
      topics: ["new-topic", "updated"],
      now: updatedAt,
    });

    expect(result.status).toBe("overwritten");
    const content = await readFile(result.path, "utf8");
    expect(content).toContain('topics: ["new-topic", "updated"]\n');
    expect(content).not.toContain('"old"');
  });

  it("creates plans dir when missing", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "missing", "plans");

    const result = await writePlan(plansDir, "phase-1", body, {
      projectId: "my-app",
      now: createdAt,
    });

    await access(plansDir);
    expect(result.status).toBe("created");
    expect(result.path).toBe(path.join(plansDir, "phase-1.md"));
  });

  it("refuses without force and leaves the file untouched", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");

    const first = await writePlan(plansDir, "phase-1", body, {
      projectId: "my-app",
      now: createdAt,
    });
    const original = await readFile(first.path, "utf8");

    const second = await writePlan(plansDir, "phase-1", "# overwritten body\n", {
      projectId: "my-app",
      now: updatedAt,
    });

    expect(second).toEqual({ path: first.path, status: "exists" });
    expect(await readFile(first.path, "utf8")).toBe(original);
  });

  it("overwrites with force, preserves created, sets updated", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");

    await writePlan(plansDir, "phase-1", body, {
      projectId: "my-app",
      now: createdAt,
    });

    const newBody = "# Updated goal\n";
    const result = await writePlan(plansDir, "phase-1", newBody, {
      projectId: "my-app",
      force: true,
      now: updatedAt,
    });

    expect(result.status).toBe("overwritten");
    expect(await readFile(result.path, "utf8")).toBe(
      [
        "---",
        'project: "my-app"',
        `created: "${createdAt.toISOString()}"`,
        `updated: "${updatedAt.toISOString()}"`,
        "---",
        "",
        newBody,
      ].join("\n"),
    );
  });

  it("falls back to now for created when existing frontmatter has none", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");
    await mkdir(plansDir, { recursive: true });
    const filePath = path.join(plansDir, "legacy.md");
    await writeFile(filePath, "# no frontmatter\n", "utf8");

    const result = await writePlan(plansDir, "legacy", "# new\n", {
      projectId: "my-app",
      force: true,
      now: updatedAt,
    });

    expect(result.status).toBe("overwritten");
    const content = await readFile(result.path, "utf8");
    expect(content).toContain(`created: "${updatedAt.toISOString()}"`);
    expect(content).toContain(`updated: "${updatedAt.toISOString()}"`);
  });

  it("updatePlanAtPath overwrites by exact path without renaming", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const plansDir = path.join(env.vault, "plans");
    await mkdir(plansDir, { recursive: true });
    const filePath = path.join(plansDir, "document 1.md");
    await writeFile(
      filePath,
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
    const result = await updatePlanAtPath(filePath, newBody, {
      projectId: "my-app",
      now: updatedAt,
    });

    expect(result).toEqual({ path: filePath, status: "overwritten" });
    expect(await readFile(filePath, "utf8")).toBe(
      [
        "---",
        'project: "my-app"',
        `created: "${createdAt.toISOString()}"`,
        `updated: "${updatedAt.toISOString()}"`,
        "---",
        "",
        newBody,
      ].join("\n"),
    );
  });
});
