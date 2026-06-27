import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeNote } from "../../src/vault/write-note.js";
import { createTempEnv } from "../helpers.js";

describe("vault/write-note", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("writes a note file with slugified text", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const notesDir = path.join(env.vault, "notes");

    const writtenPath = await writeNote(notesDir, "Investigate auth middleware");
    expect(writtenPath).toBe(path.join(notesDir, "investigate-auth-middleware.md"));
    expect(await readFile(writtenPath, "utf8")).toBe("Investigate auth middleware");
  });

  it("uses --title slug when provided", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const notesDir = path.join(env.vault, "notes");

    const writtenPath = await writeNote(notesDir, "body", { title: "Custom Title" });
    expect(writtenPath).toBe(path.join(notesDir, "custom-title.md"));
  });

  it("appends time suffix on slug collision", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const notesDir = path.join(env.vault, "notes");
    const fixedTime = new Date("2026-06-26T14:30:00");

    const first = await writeNote(notesDir, "first", { title: "dup", now: fixedTime });
    const second = await writeNote(notesDir, "second", { title: "dup", now: fixedTime });

    expect(first).toBe(path.join(notesDir, "dup.md"));
    expect(second).toBe(path.join(notesDir, "dup-1430.md"));
    expect(await readFile(second, "utf8")).toBe("second");
  });
});
