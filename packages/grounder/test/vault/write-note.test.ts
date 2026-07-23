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

  const fixedTime = new Date("2026-06-26T14:30:00");

  it("writes a note file with timestamp and short slug", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const notesDir = path.join(env.vault, "notes");

    const writtenPath = await writeNote(notesDir, "Investigate auth middleware", {
      now: fixedTime,
    });
    expect(writtenPath).toBe(path.join(notesDir, "2026-06-26-143000-investigate-auth-mid.md"));
    expect(await readFile(writtenPath, "utf8")).toBe("Investigate auth middleware");
  });

  it("uses --title for the slug part", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const notesDir = path.join(env.vault, "notes");

    const writtenPath = await writeNote(notesDir, "body", {
      title: "Custom Title",
      now: fixedTime,
    });
    expect(writtenPath).toBe(path.join(notesDir, "2026-06-26-143000-custom-title.md"));
  });

  it("truncates long text to a short slug", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const notesDir = path.join(env.vault, "notes");
    const text =
      "very long, very long, very long, very long, very long, very long, very long, very long, very long, very long, very long, very long, very long, POST";

    const writtenPath = await writeNote(notesDir, text, { now: fixedTime });
    expect(writtenPath).toBe(path.join(notesDir, "2026-06-26-143000-very-long-very-long.md"));
    expect(await readFile(writtenPath, "utf8")).toBe(text);
  });

  it("uses _NN suffix on slug collision", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;
    const notesDir = path.join(env.vault, "notes");

    const first = await writeNote(notesDir, "first", { title: "dup", now: fixedTime });
    const second = await writeNote(notesDir, "second", { title: "dup", now: fixedTime });

    expect(first).toBe(path.join(notesDir, "2026-06-26-143000-dup.md"));
    expect(second).toBe(path.join(notesDir, "2026-06-26-143000-dup_02.md"));
    expect(await readFile(second, "utf8")).toBe("second");
  });
});
