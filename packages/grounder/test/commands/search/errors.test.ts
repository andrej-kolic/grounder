import { afterEach, describe, expect, it, vi } from "vitest";
import { runLinkWithOptions } from "../../../src/commands/link.js";
import { runSearch, runSearchWithOptions } from "../../../src/commands/search.js";
import { writeHomeConfig } from "../../../src/connector/home.js";
import { captureStdout, createTempEnv } from "../../helpers.js";

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

describe("commands/search errors", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("returns standard stderr hint when unlinked", async () => {
    const env = await createTempEnv({ packageName: "my-app", initGit: false });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });

    const { code, err } = await captureStderr(() =>
      runSearchWithOptions({
        homeDir: env.home,
        cwd: env.repo,
        query: "versioning",
      }),
    );

    expect(code).toBe(1);
    expect(err).toContain("Folder not linked. Run: grounder link");
  });

  it("rejects --markdown and --json together", async () => {
    const env = await createTempEnv({ packageName: "my-app", initGit: false });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, err } = await captureStderr(() => runSearch(["hooks", "--markdown", "--json"]));

    expect(code).toBe(1);
    expect(err).toContain("Use only one of --markdown or --json.");
  });

  it("returns usage error for unknown flags", async () => {
    const { code, err } = await captureStderr(() => runSearch(["hooks", "--bogus"]));

    expect(code).toBe(1);
    expect(err).toContain("Usage: grounder search");
  });

  it("returns usage error when query is missing", async () => {
    const { code, err } = await captureStderr(() => runSearch([]));

    expect(code).toBe(1);
    expect(err).toContain("Usage: grounder search");
  });

  it("rejects invalid --since values", async () => {
    const env = await createTempEnv({ packageName: "my-app", initGit: false });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, err } = await captureStderr(() =>
      runSearch(["hooks", "--since", "not-a-date", "--json"]),
    );

    expect(code).toBe(1);
    expect(err).toContain('Invalid --since: "not-a-date"');
  });

  it("prints no matches summary without error when nothing matches", async () => {
    const env = await createTempEnv({ packageName: "my-app", initGit: false });
    cleanup = env.cleanup;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });
    await runLinkWithOptions({ cwd: env.repo, yes: true, homeDir: env.home });

    const { code, out } = await captureStdout(() =>
      runSearchWithOptions({
        homeDir: env.home,
        cwd: env.repo,
        query: "zzz-no-match-token",
        json: true,
      }),
    );

    expect(code).toBe(0);
    const payload = JSON.parse(out.trim()) as {
      summary: string;
      totalFileCount: number;
      hits: unknown[];
    };
    expect(payload.summary).toContain('No matches for "zzz-no-match-token".');
    expect(payload.totalFileCount).toBe(0);
    expect(payload.hits).toEqual([]);
  });
});
