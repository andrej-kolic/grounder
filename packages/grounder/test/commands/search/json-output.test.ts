import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runLinkWithOptions } from "../../../src/commands/link.js";
import { runSearchWithOptions } from "../../../src/commands/search.js";
import { writeHomeConfig } from "../../../src/connector/home.js";
import { captureStdout, createTempEnv } from "../../helpers.js";

describe("commands/search json output", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("includes relativePath, fileUri, and alsoMatchedHint per hit", async () => {
    const env = await createTempEnv({ packageName: "my-app", initGit: false });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const projectRoot = path.join(env.vault, "10-Projects", "my-app");
    const spacedDir = path.join(projectRoot, "archive", "0.2.0 and older");
    await mkdir(spacedDir, { recursive: true });
    const notePath = path.join(spacedDir, "hooks.md");
    await writeFile(notePath, "session hooks must exit 0\n", "utf8");

    const { code, out } = await captureStdout(() =>
      runSearchWithOptions({
        homeDir: env.home,
        cwd: env.repo,
        query: "session hooks",
        terms: ["session hooks"],
        limit: 5,
        json: true,
      }),
    );

    expect(code).toBe(0);
    const payload = JSON.parse(out.trim()) as {
      hits: Array<{
        file: string;
        relativePath: string;
        fileUri: string;
        alsoMatchedHint: string;
        matches: Array<{ term: string }>;
      }>;
    };

    expect(payload.hits.length).toBeGreaterThan(0);
    const hit = payload.hits.find((entry) => entry.file === notePath);
    expect(hit).toBeDefined();
    expect(hit?.relativePath).toBe("archive/0.2.0 and older/hooks.md");
    expect(hit?.relativePath).not.toContain("10-Projects/");
    expect(hit?.fileUri).toBe(pathToFileURL(notePath).href);
    expect(hit?.alsoMatchedHint).toContain("hooks");
    expect(hit?.alsoMatchedHint).toContain("—");
    expect(hit?.alsoMatchedHint).toContain("session hooks");
  });

  it("emits termHitCounts for every term, including zero-hit terms", async () => {
    const env = await createTempEnv({ packageName: "my-app", initGit: false });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const notesDir = path.join(env.vault, "10-Projects", "my-app", "notes");
    await mkdir(notesDir, { recursive: true });
    await writeFile(path.join(notesDir, "hooks.md"), "session hooks must exit 0\n", "utf8");

    const { code, out } = await captureStdout(() =>
      runSearchWithOptions({
        homeDir: env.home,
        cwd: env.repo,
        query: "session hooks",
        terms: ["session hooks", "nonexistent-vault-token"],
        json: true,
      }),
    );

    expect(code).toBe(0);
    const payload = JSON.parse(out.trim()) as {
      terms: string[];
      termHitCounts: Record<string, number>;
    };

    expect(payload.terms).toContain("session hooks");
    expect(payload.terms).toContain("nonexistent-vault-token");
    expect(payload.termHitCounts["session hooks"]).toBeGreaterThan(0);
    expect(payload.termHitCounts["nonexistent-vault-token"]).toBe(0);
  });
});
