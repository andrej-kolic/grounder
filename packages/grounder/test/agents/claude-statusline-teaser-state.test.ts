import { mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claude } from "../../src/agents/claude.js";
import {
  CLAUDE_AGENT_ID,
  isFirstHandoffTeaserRender,
} from "../../src/agents/claude-statusline-teaser-state.js";
import { createTempEnv } from "../helpers.js";

describe("agents/claude-statusline-teaser-state", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("CLAUDE_AGENT_ID stays in sync with claude.id", () => {
    expect(CLAUDE_AGENT_ID).toBe(claude.id);
  });

  it("returns true on the first check for a session, false after", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const first = await isFirstHandoffTeaserRender("session-a", env.home);
    const second = await isFirstHandoffTeaserRender("session-a", env.home);
    const third = await isFirstHandoffTeaserRender("session-a", env.home);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(third).toBe(false);
  });

  it("tracks each session id independently", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await isFirstHandoffTeaserRender("session-a", env.home);

    expect(await isFirstHandoffTeaserRender("session-b", env.home)).toBe(true);
    expect(await isFirstHandoffTeaserRender("session-a", env.home)).toBe(false);
  });

  it("prunes markers older than 24h so the store does not grow unbounded", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const dir = path.join(env.home, ".grounder", "tmp", CLAUDE_AGENT_ID, "statusline-seen");
    await mkdir(dir, { recursive: true });
    const staleFile = path.join(dir, "ancient-session");
    await writeFile(staleFile, "");
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(staleFile, oldTime, oldTime);

    await isFirstHandoffTeaserRender("session-fresh", env.home);

    const remaining = await readdir(dir);
    expect(remaining.sort()).toEqual(["session-fresh"]);
  });

  it("does not prune a recent marker", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await isFirstHandoffTeaserRender("session-a", env.home);
    await isFirstHandoffTeaserRender("session-b", env.home);

    const dir = path.join(env.home, ".grounder", "tmp", CLAUDE_AGENT_ID, "statusline-seen");
    const remaining = await readdir(dir);
    expect(remaining.sort()).toEqual(["session-a", "session-b"]);
  });
});
