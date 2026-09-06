import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cursor, cursorSkillsDir } from "../../src/agents/cursor.js";
import { installDriftDetected } from "../../src/commands/install-drift.js";
import { runSetupWithOptions } from "../../src/commands/setup.js";
import { readGrounderState, writeGrounderState } from "../../src/connector/state.js";
import { hashContent } from "../../src/util/hash.js";
import { createTempEnv } from "../helpers.js";

describe("commands/install-drift", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("reports no drift right after a fresh setup", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    const state = await readGrounderState(env.home);
    expect(await installDriftDetected(state, env.home)).toBe(false);
  });

  it("reports drift for an owned ledger-tracked path that is neither desired nor tombstoned", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    // A skill retired from a future release with nobody adding it to
    // `tombstones()` — before this fix, `installDriftDetected` only compared
    // ledger hashes against `desired` and checked tombstone presence, so a
    // ledger key in neither set (which `migrate` still forgets/deletes) was
    // invisible to `status`/`peek`. Path must sit under Cursor's
    // `ownedPrefixes` (`cursorSkillsDir`) — `installDriftDetected` filters
    // through `ownedLedgerFiles()` the same as `migrate`/`doctor`, so a path
    // outside it would never be something `migrate` could act on.
    const state = await readGrounderState(env.home);
    if (!state) {
      throw new Error("expected install state after setup");
    }
    const staleOwnedPath = path.join(cursorSkillsDir(env.home), "grounder-old-skill", "SKILL.md");
    await writeGrounderState(
      {
        ...state,
        agents: {
          ...state.agents,
          cursor: {
            ...state.agents.cursor,
            files: {
              ...state.agents.cursor?.files,
              [staleOwnedPath]: { hash: "sha256:stale" },
            },
          },
        },
      },
      env.home,
    );

    expect(await installDriftDetected(await readGrounderState(env.home), env.home)).toBe(true);
  });

  it("ignores a ledger-tracked path outside the adapter's owned prefixes", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    // A stray/hand-edited ledger entry outside `ownedPrefixes` is invisible to
    // `reconcile()` and refused on apply (see `ownedLedgerFiles()`), so it
    // must not be counted as drift here either — otherwise `status`/`peek`
    // would nag `migrate` forever for a path `migrate` will never touch.
    const state = await readGrounderState(env.home);
    if (!state) {
      throw new Error("expected install state after setup");
    }
    await writeGrounderState(
      {
        ...state,
        agents: {
          ...state.agents,
          cursor: {
            ...state.agents.cursor,
            files: {
              ...state.agents.cursor?.files,
              "/nowhere/grounder-old-skill/SKILL.md": { hash: "sha256:stale" },
            },
          },
        },
      },
      env.home,
    );

    expect(await installDriftDetected(await readGrounderState(env.home), env.home)).toBe(false);
  });

  it("does not report drift when the checking process's invocation differs from the recorded one", async () => {
    // Simulates the VS Code/Cursor extension host (a different process.execPath)
    // checking status after a real `setup`/`migrate` ran from a terminal:
    // installDriftDetected must replay the ledger's `lastInvocation`, not this
    // process's own runtimeInvocation(), or every cross-process check would
    // report false drift forever. See docs/architecture/runtime-invocation.md's
    // "Drift checks must not use the checking process's own interpreter path".
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    const otherInvocation = "'/other/process/node' '/other/process/.grounder/runtime/dist/cli.js'";
    const otherContent = await cursor.desiredArtifacts(env.home, { invocation: otherInvocation });

    const state = await readGrounderState(env.home);
    if (!state) {
      throw new Error("expected install state after setup");
    }
    const files: Record<string, { hash: string }> = {};
    for (const [p, content] of Object.entries(otherContent)) {
      files[p] = { hash: hashContent(content) };
    }
    await writeGrounderState(
      {
        ...state,
        agents: {
          ...state.agents,
          cursor: { ...state.agents.cursor, files, lastInvocation: otherInvocation },
        },
      },
      env.home,
    );

    expect(await installDriftDetected(await readGrounderState(env.home), env.home)).toBe(false);
  });

  it("falls back to the live invocation, and can report drift, for a ledger predating lastInvocation", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runSetupWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    const otherInvocation = "'/other/process/node' '/other/process/.grounder/runtime/dist/cli.js'";
    const otherContent = await cursor.desiredArtifacts(env.home, { invocation: otherInvocation });

    const state = await readGrounderState(env.home);
    if (!state) {
      throw new Error("expected install state after setup");
    }
    const files: Record<string, { hash: string }> = {};
    for (const [p, content] of Object.entries(otherContent)) {
      files[p] = { hash: hashContent(content) };
    }
    // No `lastInvocation` recorded — pre-fix ledger shape. Without it to
    // replay, the cheap check falls back to today's behavior (this process's
    // own live invocation), which legitimately differs from `otherInvocation`
    // here, so this is real, correctly-reported drift, not the bug.
    await writeGrounderState(
      { ...state, agents: { ...state.agents, cursor: { ...state.agents.cursor, files } } },
      env.home,
    );

    expect(await installDriftDetected(await readGrounderState(env.home), env.home)).toBe(true);
  });
});
