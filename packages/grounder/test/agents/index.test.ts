import { afterEach, describe, expect, it } from "vitest";
import { resolveAgents } from "../../src/agents/index.js";
import { createTempEnv } from "../helpers.js";

describe("agents/index - resolveAgents", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let prevHome: string | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
    // Restore GROUNDER_HOME
    if (prevHome === undefined) delete process.env.GROUNDER_HOME;
    else process.env.GROUNDER_HOME = prevHome;
  });

  it("returns explicitly requested adapters by id", async () => {
    const agents = await resolveAgents(["cursor"]);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("cursor");
  });

  it("throws on unknown agent id", async () => {
    await expect(resolveAgents(["windsurf"])).rejects.toThrow("Unknown agent id(s): windsurf");
  });

  it("auto-detects: returns empty when no agents installed", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    prevHome = process.env.GROUNDER_HOME;
    process.env.GROUNDER_HOME = env.home;

    const agents = await resolveAgents();
    expect(agents).toHaveLength(0);
  });
});
