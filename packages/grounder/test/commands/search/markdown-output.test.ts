import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLinkWithOptions } from "../../../src/commands/link.js";
import { runSearchWithOptions } from "../../../src/commands/search.js";
import { writeHomeConfig } from "../../../src/connector/home.js";
import { captureStdout, createTempEnv } from "../../helpers.js";

describe("commands/search markdown output", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("encodes spaces in file:// links and uses fenced snippets", async () => {
    const env = await createTempEnv({ packageName: "my-app", initGit: false });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const spacedDir = path.join(env.vault, "10-Projects", "my-app", "archive", "0.2.0 and older");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(spacedDir, { recursive: true }));
    const notePath = path.join(spacedDir, "hooks.md");
    await writeFile(notePath, "> quoted line with version marker\n", "utf8");

    const { code, out } = await captureStdout(() =>
      runSearchWithOptions({
        homeDir: env.home,
        cwd: env.repo,
        query: "version",
        limit: 5,
        markdown: true,
      }),
    );

    expect(code).toBe(0);
    expect(out).toContain(pathToFileURL(notePath).href);
    expect(out).not.toMatch(/\[hooks\]\(file:\/\/[^)]* and older/);
    expect(out).toContain("```");
    expect(out).toContain("> quoted line with version marker");
    expect(out).not.toContain("> > quoted");
  });

  it("errors when project vault root is missing", async () => {
    const env = await createTempEnv({ packageName: "my-app", initGit: false });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const missingRoot = path.join(env.vault, "10-Projects", "my-app");
    await rm(missingRoot, { recursive: true, force: true });

    let stderr = "";
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    const { code, out } = await captureStdout(() =>
      runSearchWithOptions({
        homeDir: env.home,
        cwd: env.repo,
        query: "version",
        markdown: true,
      }),
    );

    errSpy.mockRestore();
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(stderr).toContain("Project vault root not found:");
    expect(stderr).toContain("grounder setup");
  });
});
