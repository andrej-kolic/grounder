import { mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claude } from "../../src/agents/claude.js";
import {
  CLAUDE_AGENT_ID,
  hasHandoffTeaserBeenShown,
  markHandoffTeaserShown,
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

  it("reports not-shown until explicitly marked, then shown after", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    expect(await hasHandoffTeaserBeenShown("session-a", env.home)).toBe(false);
    expect(await hasHandoffTeaserBeenShown("session-a", env.home)).toBe(false);

    await markHandoffTeaserShown("session-a", env.home);

    expect(await hasHandoffTeaserBeenShown("session-a", env.home)).toBe(true);
    expect(await hasHandoffTeaserBeenShown("session-a", env.home)).toBe(true);
  });

  it("tracks each session id independently", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await markHandoffTeaserShown("session-a", env.home);

    expect(await hasHandoffTeaserBeenShown("session-b", env.home)).toBe(false);
    expect(await hasHandoffTeaserBeenShown("session-a", env.home)).toBe(true);
  });

  it("marking is idempotent", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await markHandoffTeaserShown("session-a", env.home);
    await markHandoffTeaserShown("session-a", env.home);

    expect(await hasHandoffTeaserBeenShown("session-a", env.home)).toBe(true);
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

    await markHandoffTeaserShown("session-fresh", env.home);

    const remaining = await readdir(dir);
    expect(remaining.sort()).toEqual(["session-fresh"]);
  });

  it("does not prune a recent marker", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await markHandoffTeaserShown("session-a", env.home);
    await markHandoffTeaserShown("session-b", env.home);

    const dir = path.join(env.home, ".grounder", "tmp", CLAUDE_AGENT_ID, "statusline-seen");
    const remaining = await readdir(dir);
    expect(remaining.sort()).toEqual(["session-a", "session-b"]);
  });

  it("keeps suppressing a session whose own marker has aged past the prune window", async () => {
    // Regression guard: a session left open (or resumed) for >24h must stay
    // suppressed, per docs/session-hooks.md ("stays suppressed across a
    // resume too"). A `hasHandoffTeaserBeenShown` check refreshes the
    // marker's mtime, so a later prune pass (triggered by marking a
    // different session) must not sweep this session's own stale-looking
    // marker.
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await markHandoffTeaserShown("session-a", env.home);

    const dir = path.join(env.home, ".grounder", "tmp", CLAUDE_AGENT_ID, "statusline-seen");
    const file = path.join(dir, "session-a");
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(file, oldTime, oldTime);

    expect(await hasHandoffTeaserBeenShown("session-a", env.home)).toBe(true);

    await markHandoffTeaserShown("session-b", env.home);
    const remaining = await readdir(dir);
    expect(remaining.sort()).toEqual(["session-a", "session-b"]);
  });

  it("treats a session id outside the safe charset as never-persisted (always not-shown, touches no file)", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const unsafeIds = ["../escape", "a/b", "..", ".", ""];
    for (const id of unsafeIds) {
      expect(await hasHandoffTeaserBeenShown(id, env.home)).toBe(false);
      await markHandoffTeaserShown(id, env.home);
      expect(await hasHandoffTeaserBeenShown(id, env.home)).toBe(false);
    }

    const dir = path.join(env.home, ".grounder", "tmp", CLAUDE_AGENT_ID, "statusline-seen");
    await expect(readdir(dir)).rejects.toThrow();
  });
});
