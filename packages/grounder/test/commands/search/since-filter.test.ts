import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLinkWithOptions } from "../../../src/commands/link.js";
import { runSearchWithOptions } from "../../../src/commands/search.js";
import { writeHomeConfig } from "../../../src/connector/home.js";
import { captureStdout, createTempEnv } from "../../helpers.js";

describe("commands/search since filter", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("excludes files older than --since", async () => {
    const env = await createTempEnv({ packageName: "my-app", initGit: false });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const notesDir = path.join(env.vault, "10-Projects", "my-app", "notes");
    await mkdir(notesDir, { recursive: true });
    const oldPath = path.join(notesDir, "old-handoff.md");
    const newPath = path.join(notesDir, "new-handoff.md");
    await writeFile(oldPath, "migrate ledger notes\n", "utf8");
    await writeFile(newPath, "migrate ledger notes\n", "utf8");

    const oldMtime = new Date("2020-01-01T12:00:00Z").getTime();
    const newMtime = new Date("2026-08-15T12:00:00Z").getTime();
    await utimes(oldPath, oldMtime / 1000, oldMtime / 1000);
    await utimes(newPath, newMtime / 1000, newMtime / 1000);

    const since = new Date("2026-08-01T00:00:00Z");

    const { code, out } = await captureStdout(() =>
      runSearchWithOptions({
        homeDir: env.home,
        cwd: env.repo,
        query: "migrate",
        json: true,
        since,
      }),
    );

    expect(code).toBe(0);
    const payload = JSON.parse(out.trim()) as { hits: Array<{ file: string }> };
    const files = payload.hits.map((hit) => hit.file);
    expect(files).toContain(newPath);
    expect(files).not.toContain(oldPath);
  });

  it("accepts --after as an alias for --since via argv", async () => {
    const env = await createTempEnv({ packageName: "my-app", initGit: false });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const notesDir = path.join(env.vault, "10-Projects", "my-app", "notes");
    await mkdir(notesDir, { recursive: true });
    const notePath = path.join(notesDir, "recent.md");
    await writeFile(notePath, "hooks schema change\n", "utf8");

    const { runSearch } = await import("../../../src/commands/search.js");
    const prevCwd = process.cwd();
    process.chdir(env.repo);
    try {
      const { code, out } = await captureStdout(() =>
        runSearch(["hooks", "--after", "2026-01-01", "--json"]),
      );

      expect(code).toBe(0);
      const payload = JSON.parse(out.trim()) as { hits: Array<{ file: string }> };
      expect(payload.hits.some((hit) => hit.file === notePath)).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
