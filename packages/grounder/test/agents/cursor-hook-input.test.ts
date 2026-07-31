import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readCursorHookWorkspaceRoot } from "../../src/agents/cursor-hook-input.js";

function streamFrom(data: string | null, options?: { isTTY?: boolean }): NodeJS.ReadableStream {
  if (options?.isTTY) {
    const stdin = new Readable({
      read() {
        this.push(null);
      },
    }) as NodeJS.ReadableStream & { isTTY?: boolean };
    stdin.isTTY = true;
    return stdin;
  }

  if (data === null) {
    // Never-ending stream (no end) — exercises the timeout path.
    return new Readable({
      read() {
        /* intentionally empty — no data, no end */
      },
    });
  }

  return Readable.from([data]);
}

describe("agents/cursor-hook-input", () => {
  it("returns workspace_roots[0] from valid Cursor hook JSON", async () => {
    const stdin = streamFrom(
      JSON.stringify({ workspace_roots: ["/Users/me/dev/my-app", "/other"] }),
    );
    await expect(readCursorHookWorkspaceRoot(stdin)).resolves.toBe("/Users/me/dev/my-app");
  });

  it("returns undefined when workspace_roots is missing", async () => {
    const stdin = streamFrom(JSON.stringify({ conversation_id: "abc" }));
    await expect(readCursorHookWorkspaceRoot(stdin)).resolves.toBeUndefined();
  });

  it("returns undefined when workspace_roots is empty", async () => {
    const stdin = streamFrom(JSON.stringify({ workspace_roots: [] }));
    await expect(readCursorHookWorkspaceRoot(stdin)).resolves.toBeUndefined();
  });

  it("returns undefined when first root is not a non-empty string", async () => {
    const stdin = streamFrom(JSON.stringify({ workspace_roots: ["", "  ", 42] }));
    await expect(readCursorHookWorkspaceRoot(stdin)).resolves.toBeUndefined();
  });

  it("returns undefined for malformed JSON", async () => {
    const stdin = streamFrom("{not-json");
    await expect(readCursorHookWorkspaceRoot(stdin)).resolves.toBeUndefined();
  });

  it("returns undefined for empty stdin", async () => {
    const stdin = streamFrom("");
    await expect(readCursorHookWorkspaceRoot(stdin)).resolves.toBeUndefined();
  });

  it("returns undefined immediately for TTY stdin", async () => {
    const stdin = streamFrom(null, { isTTY: true });
    await expect(readCursorHookWorkspaceRoot(stdin)).resolves.toBeUndefined();
  });

  it("returns undefined when stdin never ends (timeout)", async () => {
    const stdin = streamFrom(null);
    await expect(readCursorHookWorkspaceRoot(stdin)).resolves.toBeUndefined();
  });
});
