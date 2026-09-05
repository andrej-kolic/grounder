import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readGrounderState, statePath } from "../../src/connector/state.js";
import { applyPlan } from "../../src/reconcile/apply.js";
import { fileExists } from "../../src/util/fs.js";
import { hashContent } from "../../src/util/hash.js";
import { createTempEnv } from "../helpers.js";

describe("reconcile/apply", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("writes create/update entries and records their hash in the ledger", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const filePath = path.join(env.home, ".cursor", "skills", "grounder-note", "SKILL.md");

    await applyPlan({
      agentId: "cursor",
      plan: [{ path: filePath, action: "create" }],
      content: { [filePath]: "hello\n" },
      grounderVersion: "0.6.0",
      homeDir: env.home,
      ownedPrefixes: [env.home],
    });

    expect(await readFile(filePath, "utf8")).toBe("hello\n");
    const state = await readGrounderState(env.home);
    expect(state?.agents.cursor?.files[filePath]?.hash).toBe(hashContent("hello\n"));
  });

  it("deletes the file and forgets the ledger entry for a delete entry", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const filePath = path.join(env.home, "legacy.md");
    await writeFile(filePath, "old\n", "utf8");

    await applyPlan({
      agentId: "cursor",
      plan: [{ path: filePath, action: "create" }],
      content: { [filePath]: "old\n" },
      grounderVersion: "0.6.0",
      homeDir: env.home,
      ownedPrefixes: [env.home],
    });

    await applyPlan({
      agentId: "cursor",
      plan: [{ path: filePath, action: "delete" }],
      content: {},
      grounderVersion: "0.6.0",
      homeDir: env.home,
      ownedPrefixes: [env.home],
    });

    expect(await fileExists(filePath)).toBe(false);
    expect((await readGrounderState(env.home))?.agents.cursor?.files[filePath]).toBeUndefined();
  });

  it("a delete whose unlink fails (not ENOENT) throws and leaves the ledger entry intact", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    // A directory in place of the expected file — unlink() on it fails with
    // EISDIR/EPERM, never ENOENT, without needing to mock node:fs/promises.
    const dirAsFilePath = path.join(env.home, "legacy-dir.md");
    await mkdir(dirAsFilePath, { recursive: true });

    const { setLedgerFileHash } = await import("../../src/connector/state.js");
    await setLedgerFileHash({
      agentId: "cursor",
      filePath: dirAsFilePath,
      hash: "sha256:whatever",
      grounderVersion: "0.5.0",
      homeDir: env.home,
    });

    await expect(
      applyPlan({
        agentId: "cursor",
        plan: [{ path: dirAsFilePath, action: "delete" }],
        content: {},
        grounderVersion: "0.6.0",
        homeDir: env.home,
        ownedPrefixes: [env.home],
      }),
    ).rejects.toThrow();

    // Still on disk (delete failed) and the ledger still remembers it — a
    // failed delete must never be forgotten, or a future run would see "on
    // disk, no ledger, not desired" and nothing left to retry it.
    expect(await fileExists(dirAsFilePath)).toBe(true);
    expect((await readGrounderState(env.home))?.agents.cursor?.files[dirAsFilePath]?.hash).toBe(
      "sha256:whatever",
    );
  });

  it("forget entries touch only the ledger, never the filesystem", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const filePath = path.join(env.home, "already-gone.md");

    const { setLedgerFileHash } = await import("../../src/connector/state.js");
    await setLedgerFileHash({
      agentId: "cursor",
      filePath,
      hash: "sha256:stale",
      grounderVersion: "0.5.0",
      homeDir: env.home,
    });

    await applyPlan({
      agentId: "cursor",
      plan: [{ path: filePath, action: "forget" }],
      content: {},
      grounderVersion: "0.6.0",
      homeDir: env.home,
      ownedPrefixes: [env.home],
    });

    expect(await fileExists(filePath)).toBe(false);
    expect((await readGrounderState(env.home))?.agents.cursor?.files[filePath]).toBeUndefined();
  });

  it("conflict entries write nothing and leave the ledger untouched", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const filePath = path.join(env.home, "note.md");
    await writeFile(filePath, "user edits\n", "utf8");

    await applyPlan({
      agentId: "cursor",
      plan: [{ path: filePath, action: "conflict", blockedAction: "overwrite" }],
      content: { [filePath]: "template content\n" },
      grounderVersion: "0.6.0",
      homeDir: env.home,
      ownedPrefixes: [env.home],
    });

    expect(await readFile(filePath, "utf8")).toBe("user edits\n");
    expect(await fileExists(statePath(env.home))).toBe(false);
  });

  it("noop entries hydrate a missing ledger hash for a path that already matches on disk", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const filePath = path.join(env.home, "note.md");
    await writeFile(filePath, "already correct\n", "utf8");

    await applyPlan({
      agentId: "cursor",
      plan: [{ path: filePath, action: "noop" }],
      content: { [filePath]: "already correct\n" },
      grounderVersion: "0.6.0",
      homeDir: env.home,
      ownedPrefixes: [env.home],
    });

    expect((await readGrounderState(env.home))?.agents.cursor?.files[filePath]?.hash).toBe(
      hashContent("already correct\n"),
    );
  });

  it("ledger writes are atomic (tmp file + rename) — no partial state.json ever lands at the real path", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const filePath = path.join(env.home, ".cursor", "skills", "grounder-note", "SKILL.md");

    await applyPlan({
      agentId: "cursor",
      plan: [{ path: filePath, action: "create" }],
      content: { [filePath]: "hello\n" },
      grounderVersion: "0.6.0",
      homeDir: env.home,
      ownedPrefixes: [env.home],
    });

    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(path.dirname(statePath(env.home)));
    expect(entries.filter((name) => name.includes(".tmp-"))).toEqual([]);
    expect(entries).toContain("state.json");
  });

  it("skill file writes are atomic (tmp file + rename) — no partial SKILL.md ever lands at the real path", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const skillDir = path.join(env.home, ".cursor", "skills", "grounder-note");
    const filePath = path.join(skillDir, "SKILL.md");

    await applyPlan({
      agentId: "cursor",
      plan: [{ path: filePath, action: "create" }],
      content: { [filePath]: "hello\n" },
      grounderVersion: "0.6.0",
      homeDir: env.home,
      ownedPrefixes: [env.home],
    });

    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(skillDir);
    expect(entries.filter((name) => name.includes(".tmp-"))).toEqual([]);
    expect(entries).toEqual(["SKILL.md"]);
    expect(await readFile(filePath, "utf8")).toBe("hello\n");
  });

  it("refuses to create/update/delete a path outside the agent's owned prefixes", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const outsidePath = path.join(env.home, ".claude", "skills", "grounder-note", "SKILL.md");

    await expect(
      applyPlan({
        agentId: "cursor",
        plan: [{ path: outsidePath, action: "create" }],
        content: { [outsidePath]: "hello\n" },
        grounderVersion: "0.6.0",
        homeDir: env.home,
        ownedPrefixes: [path.join(env.home, ".cursor", "skills")],
      }),
    ).rejects.toThrow(/outside cursor's owned prefixes/);

    expect(await fileExists(outsidePath)).toBe(false);

    await expect(
      applyPlan({
        agentId: "cursor",
        plan: [{ path: outsidePath, action: "delete" }],
        content: {},
        grounderVersion: "0.6.0",
        homeDir: env.home,
        ownedPrefixes: [path.join(env.home, ".cursor", "skills")],
      }),
    ).rejects.toThrow(/outside cursor's owned prefixes/);
  });
});
