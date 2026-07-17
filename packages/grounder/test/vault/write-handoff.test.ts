import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeHandoff } from "../../src/vault/write-handoff.js";
import { createTempEnv } from "../helpers.js";

describe("vault/write-handoff", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  const fixedTime = new Date("2026-06-26T14:30:00");
  const body = `# Handoff: auth

## Done
- Wired middleware

## Next
1. Add tests
`;

  it("writes frontmatter and body under logs/", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");

    const writtenPath = await writeHandoff(logsDir, body, {
      projectId: "my-app",
      branch: "main",
      title: "auth",
      now: fixedTime,
    });

    expect(writtenPath).toBe(path.join(logsDir, "2026-06-26-1430-auth.md"));
    expect(await readFile(writtenPath, "utf8")).toBe(
      [
        "---",
        "project: my-app",
        "branch: main",
        `created: ${fixedTime.toISOString()}`,
        "title: auth",
        "---",
        "",
        body,
      ].join("\n"),
    );
  });

  it("omits branch and title when not provided", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");

    const writtenPath = await writeHandoff(logsDir, body, {
      projectId: "my-app",
      now: fixedTime,
    });

    const content = await readFile(writtenPath, "utf8");
    expect(content).toContain("project: my-app\n");
    expect(content).toContain(`created: ${fixedTime.toISOString()}\n`);
    expect(content).not.toContain("branch:");
    expect(content).not.toContain("title:");
  });

  it("creates logs dir when missing", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "missing", "logs");

    const writtenPath = await writeHandoff(logsDir, body, {
      projectId: "my-app",
      now: fixedTime,
    });

    await access(logsDir);
    expect(writtenPath.startsWith(logsDir + path.sep)).toBe(true);
  });

  it("uses second precision on slug collision", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");

    const first = await writeHandoff(logsDir, "first", {
      projectId: "my-app",
      title: "dup",
      now: fixedTime,
    });
    const second = await writeHandoff(logsDir, "second", {
      projectId: "my-app",
      title: "dup",
      now: fixedTime,
    });

    expect(first).toBe(path.join(logsDir, "2026-06-26-1430-dup.md"));
    expect(second).toBe(path.join(logsDir, "2026-06-26-143000-dup.md"));
  });

  it("uses numeric suffix when second-precision path also exists", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(path.join(logsDir, "2026-06-26-1430-dup.md"), "x", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-143000-dup.md"), "y", "utf8");

    const writtenPath = await writeHandoff(logsDir, "third", {
      projectId: "my-app",
      title: "dup",
      now: fixedTime,
    });

    expect(writtenPath).toBe(path.join(logsDir, "2026-06-26-143000-dup-2.md"));
  });
});
