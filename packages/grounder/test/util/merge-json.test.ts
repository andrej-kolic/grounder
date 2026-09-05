import { chmod, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileExists } from "../../src/util/fs.js";
import { mergeJsonFile } from "../../src/util/merge-json.js";
import { createTempEnv } from "../helpers.js";

describe("util/merge-json", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  async function tempFile(name = "config.json"): Promise<string> {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    return path.join(env.home, name);
  }

  /** Upsert a hook command into `hooks.sessionStart` by matching `command`. */
  function upsertSessionStart(
    current: Record<string, unknown>,
    entry: { command: string },
  ): Record<string, unknown> {
    const hooks =
      current.hooks && typeof current.hooks === "object" && !Array.isArray(current.hooks)
        ? { ...(current.hooks as Record<string, unknown>) }
        : {};
    const existing = Array.isArray(hooks.sessionStart) ? [...hooks.sessionStart] : [];
    const idx = existing.findIndex(
      (item) =>
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        (item as { command?: unknown }).command === entry.command,
    );
    if (idx >= 0) {
      existing[idx] = entry;
    } else {
      existing.push(entry);
    }
    return { ...current, hooks: { ...hooks, sessionStart: existing } };
  }

  it("creates a fresh file when missing", async () => {
    const filePath = await tempFile();
    const result = await mergeJsonFile(filePath, (current) =>
      upsertSessionStart(current, { command: "npx grounder handoff peek" }),
    );

    expect(result).toEqual({ ok: true, created: true, changed: true });
    const written = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    expect(written).toEqual({
      hooks: {
        sessionStart: [{ command: "npx grounder handoff peek" }],
      },
    });
  });

  it("creates parent directories when missing", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const filePath = path.join(env.home, ".cursor", "hooks.json");

    const result = await mergeJsonFile(filePath, () => ({ version: 1 }));
    expect(result).toEqual({ ok: true, created: true, changed: true });
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({ version: 1 });
  });

  it("preserves existing unrelated content", async () => {
    const filePath = await tempFile();
    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          version: 1,
          hooks: {
            beforeSubmitPrompt: [{ command: "echo other" }],
          },
          theme: "dark",
        },
        null,
        2,
      )}\n`,
    );

    const result = await mergeJsonFile(filePath, (current) =>
      upsertSessionStart(current, { command: "npx grounder handoff peek" }),
    );

    expect(result).toEqual({ ok: true, created: false, changed: true });
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      version: 1,
      hooks: {
        beforeSubmitPrompt: [{ command: "echo other" }],
        sessionStart: [{ command: "npx grounder handoff peek" }],
      },
      theme: "dark",
    });
  });

  it("re-applying the same entry is idempotent and reports no change", async () => {
    const filePath = await tempFile();
    const merge = (current: Record<string, unknown>) =>
      upsertSessionStart(current, { command: "npx grounder handoff peek" });

    await mergeJsonFile(filePath, merge);
    const before = await readFile(filePath, "utf8");
    const second = await mergeJsonFile(filePath, merge);

    expect(second).toEqual({ ok: true, created: false, changed: false });
    expect(await readFile(filePath, "utf8")).toBe(before);
    const written = JSON.parse(await readFile(filePath, "utf8")) as {
      hooks: { sessionStart: unknown[] };
    };
    expect(written.hooks.sessionStart).toHaveLength(1);
    expect(written.hooks.sessionStart[0]).toEqual({
      command: "npx grounder handoff peek",
    });
  });

  it("dry run reports the change without writing", async () => {
    const filePath = await tempFile();
    const merge = (current: Record<string, unknown>) =>
      upsertSessionStart(current, { command: "npx grounder handoff peek" });

    const result = await mergeJsonFile(filePath, merge, { dryRun: true });

    expect(result).toEqual({ ok: true, created: true, changed: true });
    expect(await fileExists(filePath)).toBe(false);
  });

  it("does not overwrite malformed JSON and returns a clear error", async () => {
    const filePath = await tempFile();
    const original = "{ not valid json\n";
    await writeFile(filePath, original);

    const result = await mergeJsonFile(filePath, () => ({ ruined: true }));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected unparseable");
    }
    expect(result.error).toBe("unparseable");
    expect(result.message).toContain(filePath);
    expect(result.message).toMatch(/invalid JSON/i);
    expect(await readFile(filePath, "utf8")).toBe(original);
  });

  it("does not overwrite a non-object JSON root", async () => {
    const filePath = await tempFile();
    await writeFile(filePath, "[1, 2, 3]\n");

    const result = await mergeJsonFile(filePath, () => ({ ruined: true }));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected unparseable");
    }
    expect(result.error).toBe("unparseable");
    expect(result.message).toMatch(/must be a JSON object/i);
    expect(await readFile(filePath, "utf8")).toBe("[1, 2, 3]\n");
  });

  it("writes pretty-printed JSON with a trailing newline", async () => {
    const filePath = await tempFile();
    await mergeJsonFile(filePath, () => ({ a: 1, b: { c: 2 } }));

    const raw = await readFile(filePath, "utf8");
    expect(raw).toBe(`${JSON.stringify({ a: 1, b: { c: 2 } }, null, 2)}\n`);
  });

  it("a merge that returns its input by reference is a no-op, even with differently-formatted on-disk JSON", async () => {
    const filePath = await tempFile();
    const original = '{\n    "a": 1,\n    "b": 2\n}\n';
    await writeFile(filePath, original);

    const result = await mergeJsonFile(filePath, (current) => current);

    expect(result).toEqual({ ok: true, created: false, changed: false });
    expect(await readFile(filePath, "utf8")).toBe(original);
  });

  it("writes via tmp file + rename, leaving no tmp sibling behind", async () => {
    const filePath = await tempFile();
    await writeFile(filePath, "{}\n");

    await mergeJsonFile(filePath, () => ({ a: 1 }));

    const entries = await readdir(path.dirname(filePath));
    expect(entries).toEqual([path.basename(filePath)]);
  });

  it.skipIf(process.platform === "win32")(
    "preserves the existing file's permission bits across a write",
    async () => {
      const filePath = await tempFile();
      await writeFile(filePath, "{}\n");
      await chmod(filePath, 0o640);

      await mergeJsonFile(filePath, () => ({ a: 1 }));

      expect((await stat(filePath)).mode & 0o777).toBe(0o640);
    },
  );
});
