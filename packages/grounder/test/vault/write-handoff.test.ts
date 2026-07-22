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

    expect(writtenPath).toBe(path.join(logsDir, "2026-06-26-143000-auth.md"));
    expect(await readFile(writtenPath, "utf8")).toBe(
      [
        "---",
        'project: "my-app"',
        'branch: "main"',
        `created: "${fixedTime.toISOString()}"`,
        'title: "auth"',
        "---",
        "",
        body,
      ].join("\n"),
    );
  });

  it("quotes title and branch so YAML stays valid", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");

    const writtenPath = await writeHandoff(logsDir, body, {
      projectId: "my-app",
      branch: "feat/foo:bar",
      title: "session: #1",
      now: fixedTime,
    });

    const content = await readFile(writtenPath, "utf8");
    expect(content).toContain('branch: "feat/foo:bar"\n');
    expect(content).toContain('title: "session: #1"\n');
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
    expect(content).toContain('project: "my-app"\n');
    expect(content).toContain(`created: "${fixedTime.toISOString()}"\n`);
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

  it("uses _NN suffix on slug collision", async () => {
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

    expect(first).toBe(path.join(logsDir, "2026-06-26-143000-dup.md"));
    expect(second).toBe(path.join(logsDir, "2026-06-26-143000-dup_02.md"));
  });

  it("increments _NN when prior collision suffixes exist", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(path.join(logsDir, "2026-06-26-143000-dup.md"), "x", "utf8");
    await writeFile(path.join(logsDir, "2026-06-26-143000-dup_02.md"), "y", "utf8");

    const writtenPath = await writeHandoff(logsDir, "third", {
      projectId: "my-app",
      title: "dup",
      now: fixedTime,
    });

    expect(writtenPath).toBe(path.join(logsDir, "2026-06-26-143000-dup_03.md"));
  });

  it("does not clobber under concurrent same-slug writes", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const logsDir = path.join(env.vault, "logs");

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        writeHandoff(logsDir, `body-${i}`, {
          projectId: "my-app",
          title: "race",
          now: fixedTime,
        }),
      ),
    );

    const unique = new Set(results);
    expect(unique.size).toBe(8);
    for (const filePath of results) {
      expect(await readFile(filePath, "utf8")).toMatch(/^---\n/);
    }
  });
});
