import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readGrounderState, recordAgentInstall } from "../../src/connector/state.js";
import { retireLegacyCommands } from "../../src/migrations/004-retire-legacy-commands.js";
import type { MigrationContext } from "../../src/migrations/types.js";
import { fileExists } from "../../src/util/fs.js";
import { hashContent } from "../../src/util/hash.js";
import { createTempEnv } from "../helpers.js";

function legacyPath(homeDir: string, agentId: "claude" | "cursor", filename: string): string {
  const dirName = agentId === "claude" ? ".claude" : ".cursor";
  return path.join(homeDir, dirName, "commands", filename);
}

async function writeLegacyFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function baseCtx(homeDir: string, overrides: Partial<MigrationContext> = {}): MigrationContext {
  return {
    homeDir,
    force: false,
    dryRun: false,
    agentIds: ["claude", "cursor"],
    state: null,
    ...overrides,
  };
}

describe("migrations/004-retire-legacy-commands", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("reports already-absent and does nothing when no legacy files exist", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const results = await retireLegacyCommands.run(baseCtx(env.home));
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.status === "already-absent")).toBe(true);
  });

  it("retires a legacy file whose on-disk hash matches the ledger", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const notePath = legacyPath(env.home, "claude", "grounder-note.md");
    await writeLegacyFile(notePath, "old note command\n");
    const state = await recordAgentInstall({
      agentId: "claude",
      grounderVersion: "0.5.0",
      files: { [notePath]: { hash: hashContent("old note command\n") } },
      homeDir: env.home,
    });

    const results = await retireLegacyCommands.run(baseCtx(env.home, { state }));
    const noteResult = results.find((r) => r.path === notePath);
    expect(noteResult?.status).toBe("retired");
    expect(await fileExists(notePath)).toBe(false);
  });

  it("drops the retired path from the ledger's files map", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const notePath = legacyPath(env.home, "claude", "grounder-note.md");
    await writeLegacyFile(notePath, "old note command\n");
    const state = await recordAgentInstall({
      agentId: "claude",
      grounderVersion: "0.5.0",
      files: { [notePath]: { hash: hashContent("old note command\n") } },
      homeDir: env.home,
    });

    await retireLegacyCommands.run(baseCtx(env.home, { state }));

    const after = await readGrounderState(env.home);
    expect(after?.agents.claude?.files[notePath]).toBeUndefined();
  });

  it("leaves a locally modified legacy file alone without --force", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const notePath = legacyPath(env.home, "claude", "grounder-note.md");
    await writeLegacyFile(notePath, "edited by hand\n");
    const state = await recordAgentInstall({
      agentId: "claude",
      grounderVersion: "0.5.0",
      files: { [notePath]: { hash: hashContent("original content\n") } },
      homeDir: env.home,
    });

    const results = await retireLegacyCommands.run(baseCtx(env.home, { state }));
    const noteResult = results.find((r) => r.path === notePath);
    expect(noteResult?.status).toBe("left-modified");
    expect(await readFile(notePath, "utf8")).toBe("edited by hand\n");
  });

  it("leaves a legacy file with no recorded hash alone (pre-ledger)", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const notePath = legacyPath(env.home, "claude", "grounder-note.md");
    await writeLegacyFile(notePath, "pre-ledger install\n");

    const results = await retireLegacyCommands.run(baseCtx(env.home, { state: null }));
    const noteResult = results.find((r) => r.path === notePath);
    expect(noteResult?.status).toBe("left-modified");
    expect(await fileExists(notePath)).toBe(true);
  });

  it("--force deletes a locally modified legacy file", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const notePath = legacyPath(env.home, "claude", "grounder-note.md");
    await writeLegacyFile(notePath, "edited by hand\n");

    const results = await retireLegacyCommands.run(baseCtx(env.home, { state: null, force: true }));
    const noteResult = results.find((r) => r.path === notePath);
    expect(noteResult?.status).toBe("retired");
    expect(await fileExists(notePath)).toBe(false);
  });

  it("--dry-run reports retired without deleting", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const notePath = legacyPath(env.home, "claude", "grounder-note.md");
    await writeLegacyFile(notePath, "old note command\n");
    const state = await recordAgentInstall({
      agentId: "claude",
      grounderVersion: "0.5.0",
      files: { [notePath]: { hash: hashContent("old note command\n") } },
      homeDir: env.home,
    });

    const results = await retireLegacyCommands.run(baseCtx(env.home, { state, dryRun: true }));
    const noteResult = results.find((r) => r.path === notePath);
    expect(noteResult?.status).toBe("retired");
    expect(await fileExists(notePath)).toBe(true);
  });

  it("only touches agents in scope", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const cursorNotePath = legacyPath(env.home, "cursor", "grounder-note.md");
    await writeLegacyFile(cursorNotePath, "cursor legacy note\n");

    const results = await retireLegacyCommands.run(baseCtx(env.home, { agentIds: ["claude"] }));
    expect(results.some((r) => r.path === cursorNotePath)).toBe(false);
    expect(await fileExists(cursorNotePath)).toBe(true);
  });
});
