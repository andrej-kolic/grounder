import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLinkWithOptions } from "../../../src/commands/link.js";
import { runSearchWithOptions } from "../../../src/commands/search.js";
import { writeHomeConfig } from "../../../src/connector/home.js";
import { captureStdout, createTempEnv } from "../../helpers.js";

describe("commands/search plain output", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("prints summary, numbered stems, paths, and line snippets", async () => {
    const env = await createTempEnv({ packageName: "my-app", initGit: false });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const notesDir = path.join(env.vault, "10-Projects", "my-app", "notes");
    await mkdir(notesDir, { recursive: true });
    const notePath = path.join(notesDir, "release-notes.md");
    await writeFile(notePath, "schema versioning for slash commands\n", "utf8");

    const { code, out } = await captureStdout(() =>
      runSearchWithOptions({
        homeDir: env.home,
        cwd: env.repo,
        query: "versioning",
        limit: 5,
      }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Found 1 matches in 1 files.");
    expect(out).toContain("1. release-notes");
    expect(out).toContain(notePath);
    expect(out).toContain("L1 (versioning): schema versioning for slash commands");
    expect(out).not.toContain("Showing top");
  });

  it("prints truncation header when results exceed limit", async () => {
    const env = await createTempEnv({ packageName: "my-app", initGit: false });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const notesDir = path.join(env.vault, "10-Projects", "my-app", "notes");
    await mkdir(notesDir, { recursive: true });
    for (let i = 0; i < 4; i++) {
      await writeFile(path.join(notesDir, `note-${i}.md`), `shared token-${i}\n`, "utf8");
    }

    const { code, out } = await captureStdout(() =>
      runSearchWithOptions({
        homeDir: env.home,
        cwd: env.repo,
        query: "shared",
        limit: 2,
      }),
    );

    expect(code).toBe(0);
    expect(out).toContain("(showing 2)");
    expect(out).toContain("Showing top 2 of 4 files.");
    expect(out).toContain("1. note-");
    expect(out).toContain("2. note-");
    expect(out).not.toContain("3. note-");
  });
});
