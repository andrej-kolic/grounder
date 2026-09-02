import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCurrentHandoffLabel } from "../../src/vault/current-handoff.js";

describe("vault/current-handoff", () => {
  let logsDir: string;
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  async function withLogsDir(): Promise<string> {
    const base = await mkdtemp(path.join(os.tmpdir(), "grounder-handoff-label-"));
    logsDir = path.join(base, "logs");
    await mkdir(logsDir, { recursive: true });
    cleanup = async () => {
      await rm(base, { recursive: true, force: true });
    };
    return logsDir;
  }

  it("collapses embedded newlines/whitespace in the title to single spaces", async () => {
    const dir = await withLogsDir();
    // `\n` here is the YAML double-quoted escape (two literal chars in the
    // file) that parseHandoffFrontmatter unescapes into a real newline —
    // exercising the same "control char embedded in title" case sanitizeLabel
    // guards against.
    await writeFile(
      path.join(dir, "2026-06-26-150000-auth.md"),
      `---
created: "2026-06-26T15:00:00.000Z"
title: "auth   fix\\nfor login"
---

body
`,
      "utf8",
    );

    const current = await resolveCurrentHandoffLabel(dir);
    expect(current?.label).toBe("auth fix for login");
  });

  it("truncates an unusually long title with an ellipsis", async () => {
    const dir = await withLogsDir();
    const longTitle = "x".repeat(200);
    await writeFile(
      path.join(dir, "2026-06-26-150000-auth.md"),
      `---
created: "2026-06-26T15:00:00.000Z"
title: "${longTitle}"
---

body
`,
      "utf8",
    );

    const current = await resolveCurrentHandoffLabel(dir);
    expect(current?.label.length).toBe(80);
    expect(current?.label.endsWith("…")).toBe(true);
    expect(current?.label.startsWith("x".repeat(79))).toBe(true);
  });

  it("leaves a normal short title untouched", async () => {
    const dir = await withLogsDir();
    await writeFile(
      path.join(dir, "2026-06-26-150000-auth.md"),
      `---
created: "2026-06-26T15:00:00.000Z"
title: "auth middleware"
---

body
`,
      "utf8",
    );

    const current = await resolveCurrentHandoffLabel(dir);
    expect(current?.label).toBe("auth middleware");
  });
});
