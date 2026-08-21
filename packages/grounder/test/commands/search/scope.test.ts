import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLinkWithOptions } from "../../../src/commands/link.js";
import { runSearchWithOptions } from "../../../src/commands/search.js";
import { writeHomeConfig } from "../../../src/connector/home.js";
import { captureStdout, createTempEnv } from "../../helpers.js";

describe("commands/search scope", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("searches only the linked project vault root, not sibling projects", async () => {
    const env = await createTempEnv({ packageName: "my-app", initGit: false });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const linkedNotes = path.join(env.vault, "10-Projects", "my-app", "notes");
    await mkdir(linkedNotes, { recursive: true });
    await writeFile(path.join(linkedNotes, "linked-only.md"), "unique-alpha-token\n", "utf8");

    const siblingNotes = path.join(env.vault, "10-Projects", "other-app", "notes");
    await mkdir(siblingNotes, { recursive: true });
    await writeFile(path.join(siblingNotes, "sibling-only.md"), "unique-alpha-token\n", "utf8");

    const { code, out } = await captureStdout(() =>
      runSearchWithOptions({
        homeDir: env.home,
        cwd: env.repo,
        query: "unique-alpha-token",
        json: true,
      }),
    );

    expect(code).toBe(0);
    const payload = JSON.parse(out.trim()) as {
      hits: Array<{ file: string; relativePath: string }>;
    };
    const paths = payload.hits.map((hit) => hit.file);
    expect(paths.some((file) => file.includes("my-app"))).toBe(true);
    expect(paths.some((file) => file.includes("other-app"))).toBe(false);
    expect(payload.hits.every((hit) => !hit.relativePath.startsWith("10-Projects/"))).toBe(true);
  });
});
