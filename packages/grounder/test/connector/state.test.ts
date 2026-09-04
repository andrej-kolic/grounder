import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertVersionSupportsWrite,
  forgetLedgerFile,
  LEDGER_SCHEMA,
  ledgerFilesFor,
  ledgerVersionChanged,
  MIN_SUPPORTED_LEDGER_SCHEMA,
  readGrounderState,
  recordedFileHash,
  recordedHooksEnabled,
  setHooksEnabled,
  setLedgerFileHash,
  statePath,
  touchGrounderVersion,
  writeGrounderState,
} from "../../src/connector/state.js";
import { UnsupportedSchemaError } from "../../src/connector/unsupported-schema.js";
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
        ledgerSchema: LEDGER_SCHEMA,
        grounderVersion: "0.3.0",
        agents: {
          cursor: { files: {} },
        },
      },
      env.home,
    );

    const state = await readGrounderState(env.home);
    expect(state).toEqual({
      ledgerSchema: LEDGER_SCHEMA,
      grounderVersion: "0.3.0",
      agents: {
        cursor: { files: {} },
      },
    });
    expect(statePath(env.home)).toBe(path.join(env.home, ".grounder", "state.json"));
    expect(JSON.parse(await readFile(statePath(env.home), "utf8"))).toEqual(state);
  });

  it("returns null when state file is missing", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    expect(await readGrounderState(env.home)).toBeNull();
    expect(ledgerFilesFor(null, "cursor")).toBeUndefined();
    expect(recordedHooksEnabled(null, "cursor")).toBeUndefined();
  });

  it("tolerates the pre-rewrite on-disk shape (commandsSchema/hooksSchema, no ledgerSchema)", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.dirname(statePath(env.home)), { recursive: true });
    await writeFile(
      statePath(env.home),
      `${JSON.stringify(
        {
          grounderVersion: "0.5.0",
          agents: {
            cursor: {
              commandsSchema: 4,
              hooksSchema: 1,
              files: { "/a/SKILL.md": { hash: "sha256:aaa" } },
            },
            claude: {
              commandsSchema: 4,
              files: {},
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const state = await readGrounderState(env.home);
    expect(state).toEqual({
      ledgerSchema: LEDGER_SCHEMA,
      grounderVersion: "0.5.0",
      agents: {
        cursor: { files: { "/a/SKILL.md": { hash: "sha256:aaa" } }, hooksEnabled: true },
        claude: { files: {} },
      },
    });
  });

  it("setLedgerFileHash merges without clobbering siblings, and is a no-op when unchanged", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await setLedgerFileHash({
      agentId: "cursor",
      filePath: "/a/SKILL.md",
      hash: "sha256:aaa",
      grounderVersion: "0.3.0",
      homeDir: env.home,
    });
    await setLedgerFileHash({
      agentId: "claude",
      filePath: "/b/SKILL.md",
      hash: "sha256:bbb",
      grounderVersion: "0.3.1",
      homeDir: env.home,
    });
    await setLedgerFileHash({
      agentId: "cursor",
      filePath: "/a2/SKILL.md",
      hash: "sha256:ccc",
      grounderVersion: "0.3.2",
      homeDir: env.home,
    });

    const state = await readGrounderState(env.home);
    expect(state).toEqual({
      ledgerSchema: LEDGER_SCHEMA,
      grounderVersion: "0.3.2",
      agents: {
        cursor: {
          files: { "/a/SKILL.md": { hash: "sha256:aaa" }, "/a2/SKILL.md": { hash: "sha256:ccc" } },
        },
        claude: { files: { "/b/SKILL.md": { hash: "sha256:bbb" } } },
      },
    });
    expect(recordedFileHash(state, "cursor", "/a/SKILL.md")).toBe("sha256:aaa");

    const before = await readFile(statePath(env.home), "utf8");
    await setLedgerFileHash({
      agentId: "cursor",
      filePath: "/a/SKILL.md",
      hash: "sha256:aaa",
      grounderVersion: "9.9.9",
      homeDir: env.home,
    });
    expect(await readFile(statePath(env.home), "utf8")).toBe(before);
  });

  it("forgetLedgerFile drops one path, no-ops when absent", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await setLedgerFileHash({
      agentId: "cursor",
      filePath: "/a/legacy.md",
      hash: "sha256:aaa",
      grounderVersion: "0.5.0",
      homeDir: env.home,
    });
    await forgetLedgerFile({
      agentId: "cursor",
      filePath: "/a/legacy.md",
      grounderVersion: "0.6.0",
      homeDir: env.home,
    });
    expect(
      recordedFileHash(await readGrounderState(env.home), "cursor", "/a/legacy.md"),
    ).toBeUndefined();

    // No-op when there's nothing to forget (no state file at all).
    const env2 = await createTempEnv({ initGit: false });
    await forgetLedgerFile({
      agentId: "cursor",
      filePath: "/a/legacy.md",
      grounderVersion: "0.6.0",
      homeDir: env2.home,
    });
    expect(await readGrounderState(env2.home)).toBeNull();
    await env2.cleanup();
  });

  it("setHooksEnabled records the tri-state and is a no-op when unchanged", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await setHooksEnabled({
      agentId: "cursor",
      enabled: true,
      grounderVersion: "0.6.0",
      homeDir: env.home,
    });
    expect(recordedHooksEnabled(await readGrounderState(env.home), "cursor")).toBe(true);

    await setHooksEnabled({
      agentId: "cursor",
      enabled: false,
      grounderVersion: "0.6.1",
      homeDir: env.home,
    });
    expect(recordedHooksEnabled(await readGrounderState(env.home), "cursor")).toBe(false);
  });

  it("touchGrounderVersion stamps the version even with no agent changes, no-ops when already current", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await touchGrounderVersion("0.6.0", env.home);
    expect((await readGrounderState(env.home))?.grounderVersion).toBe("0.6.0");

    const before = await readFile(statePath(env.home), "utf8");
    await touchGrounderVersion("0.6.0", env.home);
    expect(await readFile(statePath(env.home), "utf8")).toBe(before);

    await touchGrounderVersion("0.6.1", env.home);
    expect((await readGrounderState(env.home))?.grounderVersion).toBe("0.6.1");
  });

  it("throws on corrupt state", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.dirname(statePath(env.home)), { recursive: true });
    await writeFile(statePath(env.home), '{"agents":{}}\n', "utf8");

    await expect(readGrounderState(env.home)).rejects.toThrow(/missing grounderVersion/);
  });

  it("throws a clear error when state JSON is malformed", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.dirname(statePath(env.home)), { recursive: true });
    await writeFile(statePath(env.home), "{/\n", "utf8");

    await expect(readGrounderState(env.home)).rejects.toThrow(
      /Invalid grounder state.*Fix or remove it.*migrate --force/,
    );
  });

  describe("assertVersionSupportsWrite", () => {
    it("hard-stops only when the running binary is behind the ledger's recorded version", () => {
      expect(() =>
        assertVersionSupportsWrite("0.5.0", {
          ledgerSchema: LEDGER_SCHEMA,
          grounderVersion: "0.6.0",
          agents: {},
        }),
      ).toThrow(UnsupportedSchemaError);

      // "ahead" (normal upgrade) and "differs" (same x.y.z, different suffix)
      // both proceed — only "behind" is a write-path hard stop.
      expect(() =>
        assertVersionSupportsWrite("0.7.0", {
          ledgerSchema: LEDGER_SCHEMA,
          grounderVersion: "0.6.0",
          agents: {},
        }),
      ).not.toThrow();
      expect(() =>
        assertVersionSupportsWrite("0.6.0-dev.2", {
          ledgerSchema: LEDGER_SCHEMA,
          grounderVersion: "0.6.0-dev.1",
          agents: {},
        }),
      ).not.toThrow();

      // No state at all → nothing to protect against.
      expect(() => assertVersionSupportsWrite("0.5.0", null)).not.toThrow();
    });
  });

  describe("ledgerSchema gate", () => {
    it("throws UnsupportedSchemaError when ledgerSchema is newer than this binary", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const { mkdir } = await import("node:fs/promises");
      await mkdir(path.dirname(statePath(env.home)), { recursive: true });
      await writeFile(
        statePath(env.home),
        `${JSON.stringify(
          { ledgerSchema: LEDGER_SCHEMA + 1, grounderVersion: "9.9.9", agents: {} },
          null,
          2,
        )}\n`,
        "utf8",
      );

      await expect(readGrounderState(env.home)).rejects.toThrow(UnsupportedSchemaError);
    });

    it("throws a plain invalid-state error when ledgerSchema is older than supported", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const { mkdir } = await import("node:fs/promises");
      await mkdir(path.dirname(statePath(env.home)), { recursive: true });
      await writeFile(
        statePath(env.home),
        `${JSON.stringify(
          { ledgerSchema: MIN_SUPPORTED_LEDGER_SCHEMA - 1, grounderVersion: "0.6.0", agents: {} },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const error = await readGrounderState(env.home).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(UnsupportedSchemaError);
      expect((error as Error).message).toMatch(/older than this grounder supports/);
    });

    it("rejects a non-integer ledgerSchema instead of silently defaulting to 0", async () => {
      const env = await createTempEnv({ initGit: false });
      cleanup = env.cleanup;

      const { mkdir } = await import("node:fs/promises");
      await mkdir(path.dirname(statePath(env.home)), { recursive: true });
      await writeFile(
        statePath(env.home),
        `${JSON.stringify(
          { ledgerSchema: "not-a-number", grounderVersion: "0.6.0", agents: {} },
          null,
          2,
        )}\n`,
        "utf8",
      );

      await expect(readGrounderState(env.home)).rejects.toThrow(/ledgerSchema must be an integer/);
    });
  });

  describe("ledgerVersionChanged", () => {
    it("compares only grounderVersion", () => {
      const current = { ledgerSchema: LEDGER_SCHEMA, grounderVersion: "0.6.0", agents: {} };
      expect(ledgerVersionChanged(current, "0.6.0")).toBe(false);
      expect(ledgerVersionChanged(current, "0.6.1")).toBe(true);
      expect(ledgerVersionChanged(null, "0.6.0")).toBe(true);
    });
  });
});
