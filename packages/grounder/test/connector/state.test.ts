import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readGrounderState,
  recordAgentInstall,
  recordedCommandsSchema,
  recordedFileHash,
  recordedHooksSchema,
  statePath,
  writeGrounderState,
} from "../../src/connector/state.js";
import { createTempEnv } from "../helpers.js";

describe("connector/state", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("reads and writes grounder state", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await writeGrounderState(
      {
        grounderVersion: "0.3.0",
        agents: {
          cursor: { commandsSchema: 1, hooksSchema: 1, files: {} },
        },
      },
      env.home,
    );

    const state = await readGrounderState(env.home);
    expect(state).toEqual({
      grounderVersion: "0.3.0",
      agents: {
        cursor: { commandsSchema: 1, hooksSchema: 1, files: {} },
      },
    });
    expect(statePath(env.home)).toBe(path.join(env.home, ".grounder", "state.json"));
    expect(JSON.parse(await readFile(statePath(env.home), "utf8"))).toEqual(state);
  });

  it("returns null when state file is missing", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    expect(await readGrounderState(env.home)).toBeNull();
    expect(recordedCommandsSchema(null, "cursor")).toBe(0);
    expect(recordedHooksSchema(null, "cursor")).toBe(0);
  });

  it("merges agent install records without clobbering siblings", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await recordAgentInstall({
      agentId: "cursor",
      commandsSchema: 1,
      grounderVersion: "0.3.0",
      homeDir: env.home,
    });
    await recordAgentInstall({
      agentId: "claude",
      commandsSchema: 1,
      hooksSchema: 1,
      grounderVersion: "0.3.1",
      homeDir: env.home,
    });
    // Commands-only re-record for cursor must preserve absence of hooksSchema
    // and must not wipe claude.
    await recordAgentInstall({
      agentId: "cursor",
      commandsSchema: 2,
      grounderVersion: "0.3.2",
      homeDir: env.home,
    });

    const state = await readGrounderState(env.home);
    expect(state).toEqual({
      grounderVersion: "0.3.2",
      agents: {
        cursor: { commandsSchema: 2, files: {} },
        claude: { commandsSchema: 1, hooksSchema: 1, files: {} },
      },
    });
    expect(recordedCommandsSchema(state, "cursor")).toBe(2);
    expect(recordedHooksSchema(state, "cursor")).toBe(0);
    expect(recordedHooksSchema(state, "claude")).toBe(1);
  });

  it("preserves hooksSchema when a later commands-only record omits it", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await recordAgentInstall({
      agentId: "cursor",
      commandsSchema: 1,
      hooksSchema: 1,
      grounderVersion: "0.3.0",
      homeDir: env.home,
    });
    await recordAgentInstall({
      agentId: "cursor",
      commandsSchema: 1,
      grounderVersion: "0.3.0",
      homeDir: env.home,
    });

    const state = await readGrounderState(env.home);
    expect(state?.agents.cursor).toEqual({
      commandsSchema: 1,
      hooksSchema: 1,
      files: {},
    });
  });

  it("merges files map when recording install metadata", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await recordAgentInstall({
      agentId: "cursor",
      commandsSchema: 1,
      grounderVersion: "0.3.0",
      files: {
        "/tmp/a.md": { schema: 1, hash: "sha256:aaa" },
      },
      homeDir: env.home,
    });
    await recordAgentInstall({
      agentId: "cursor",
      commandsSchema: 1,
      grounderVersion: "0.3.0",
      files: {
        "/tmp/b.md": { schema: 1, hash: "sha256:bbb" },
      },
      homeDir: env.home,
    });

    const state = await readGrounderState(env.home);
    expect(state?.agents.cursor?.files).toEqual({
      "/tmp/a.md": { schema: 1, hash: "sha256:aaa" },
      "/tmp/b.md": { schema: 1, hash: "sha256:bbb" },
    });
    expect(recordedFileHash(state, "cursor", "/tmp/a.md")).toBe("sha256:aaa");
  });

  it("throws on corrupt state", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.dirname(statePath(env.home)), { recursive: true });
    await writeFile(statePath(env.home), '{"agents":{}}\n', "utf8");

    await expect(readGrounderState(env.home)).rejects.toThrow(/missing grounderVersion/);
  });
});
