import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { readStdinWithTimeout } from "../../src/util/read-stdin.js";

/** A minimal TTY-flagged stdin stand-in — the function checks `isTTY` before touching anything else. */
function ttyStdin(): NodeJS.ReadableStream {
  return { isTTY: true } as unknown as NodeJS.ReadableStream;
}

describe("util/read-stdin", () => {
  it("resolves undefined immediately for TTY stdin", async () => {
    const result = await readStdinWithTimeout(ttyStdin(), 1000);
    expect(result).toBeUndefined();
  });

  it("resolves undefined when nothing arrives before the timeout", async () => {
    const stdin = new PassThrough();
    const result = await readStdinWithTimeout(stdin, 20);
    expect(result).toBeUndefined();
    stdin.destroy();
  });

  it("resolves with the full payload once the stream ends before the timeout", async () => {
    const stdin = new PassThrough();
    const pending = readStdinWithTimeout(stdin, 1000);
    stdin.write("hello");
    stdin.write(" world");
    stdin.end();

    expect(await pending).toBe("hello world");
  });

  it("returns the buffered payload so far if the timeout fires before the stream ends", async () => {
    const stdin = new PassThrough();
    const pending = readStdinWithTimeout(stdin, 20);
    stdin.write("partial payload");
    // Deliberately never end()/destroy() before the timeout — simulates a
    // pipe that stays open past the deadline (e.g. a slow/hanging writer).

    expect(await pending).toBe("partial payload");
    stdin.destroy();
  });

  it("resolves undefined on a stream error", async () => {
    const stdin = new PassThrough();
    const pending = readStdinWithTimeout(stdin, 1000);
    stdin.emit("error", new Error("boom"));

    expect(await pending).toBeUndefined();
  });

  it("resolves immediately for a stream that already ended (readableEnded)", async () => {
    const stdin = new PassThrough();
    stdin.end();
    stdin.resume(); // put it in flowing mode so it actually drains to 'end'
    // Let the stream actually settle into readableEnded before invoking.
    await new Promise((resolve) => stdin.once("end", resolve));

    const result = await readStdinWithTimeout(stdin, 1000);
    expect(result).toBeUndefined();
  });
});
