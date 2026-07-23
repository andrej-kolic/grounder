import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { homeConfigPath, readHomeConfig, writeHomeConfig } from "../../src/connector/home.js";
import { createTempEnv } from "../helpers.js";

describe("connector/home", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("reads and writes home config", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const previousHome = process.env.GROUNDER_HOME;
    process.env.GROUNDER_HOME = env.home;

    await writeHomeConfig({ vaultRoot: env.vault });
    const config = await readHomeConfig();

    expect(config).toEqual({ vaultRoot: env.vault });
    expect(homeConfigPath()).toBe(path.join(env.home, ".grounder", "config.json"));
    expect(homeConfigPath(env.home)).toBe(path.join(env.home, ".grounder", "config.json"));

    process.env.GROUNDER_HOME = previousHome;
  });
});
