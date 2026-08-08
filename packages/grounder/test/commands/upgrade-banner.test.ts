import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyUpgradeIfNeeded } from "../../src/commands/upgrade-banner.js";
import { writeGrounderState } from "../../src/connector/state.js";
import { VERSION } from "../../src/index.js";
import { createTempEnv } from "../helpers.js";

describe("commands/upgrade-banner", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("prints on every call while grounderVersion lags the package", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await writeGrounderState(
      {
        grounderVersion: "0.1.0",
        agents: { cursor: { commandsSchema: 1, files: {} } },
      },
      env.home,
    );

    const chunks: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });

    const expected = `Grounder was updated (${VERSION}). Run \`grounder migrate\` to update your configuration.\n\n`;
    await notifyUpgradeIfNeeded(env.home);
    expect(chunks.join("")).toBe(expected);

    chunks.length = 0;
    await notifyUpgradeIfNeeded(env.home);
    expect(chunks.join("")).toBe(expected);
  });

  it("prints a downgrade notice when the package is older than the ledger", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await writeGrounderState(
      {
        grounderVersion: "99.0.0",
        agents: { cursor: { commandsSchema: 1, files: {} } },
      },
      env.home,
    );

    const chunks: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });

    await notifyUpgradeIfNeeded(env.home);
    expect(chunks.join("")).toBe(
      `This Grounder (${VERSION}) is older than your configuration (99.0.0). Install a newer Grounder.\n\n`,
    );
  });

  it("stays silent when grounderVersion already matches the running package", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await writeGrounderState(
      {
        grounderVersion: VERSION,
        agents: { cursor: { commandsSchema: 1, files: {} } },
      },
      env.home,
    );

    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await notifyUpgradeIfNeeded(env.home);
    expect(spy).not.toHaveBeenCalled();
  });

  it("stays silent when state is missing", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await notifyUpgradeIfNeeded(env.home);
    expect(spy).not.toHaveBeenCalled();
  });
});
