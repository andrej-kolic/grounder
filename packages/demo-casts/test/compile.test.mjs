import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileCast, expandSteps } from "../scripts/compile.mjs";

describe("expandSteps", () => {
  it("types char-by-char at fixed cps", () => {
    const events = expandSteps([{ type: "type", text: "ab", cps: 10 }]);
    assert.deepEqual(events, [
      { dt: 0.1, data: "a" },
      { dt: 0.1, data: "b" },
    ]);
  });

  it("emits output as a single chunk", () => {
    const events = expandSteps([{ type: "output", text: "hi\r\n" }]);
    assert.equal(events.length, 1);
    assert.equal(events[0].data, "hi\r\n");
    assert.ok(events[0].dt > 0);
  });

  it("waits advance time with empty data", () => {
    const events = expandSteps([{ type: "wait", seconds: 1.5 }]);
    assert.deepEqual(events, [{ dt: 1.5, data: "" }]);
  });

  it("rejects unknown step types", () => {
    assert.throws(
      () => expandSteps(/** @type {never} */ ([{ type: "nope" }])),
      /unknown step type/,
    );
  });
});

describe("compileCast", () => {
  it("emits asciicast v2 header + timed o events", () => {
    const jsonl = compileCast(
      [
        { type: "output", text: "$ " },
        { type: "type", text: "hi", cps: 10 },
        { type: "output", text: "\r\nok\r\n" },
        { type: "wait", seconds: 1 },
      ],
      { width: 40, height: 6, timestamp: 0 },
    );

    const lines = jsonl.trimEnd().split("\n");
    const header = JSON.parse(lines[0]);
    assert.equal(header.version, 2);
    assert.equal(header.width, 40);
    assert.equal(header.height, 6);
    assert.equal(header.timestamp, 0);

    const events = lines.slice(1).map((l) => JSON.parse(l));
    assert.ok(events.length >= 3);
    for (const ev of events) {
      assert.equal(ev[1], "o");
      assert.equal(typeof ev[0], "number");
      assert.equal(typeof ev[2], "string");
    }

    // typing: two chars at 0.1s each after initial output dt
    const typed = events.filter((e) => e[2] === "h" || e[2] === "i");
    assert.equal(typed.length, 2);
    assert.ok(typed[1][0] > typed[0][0]);
  });

  it("is deterministic for the same inputs", () => {
    const steps = [
      { type: "type", text: "x" },
      { type: "wait", seconds: 0.5 },
      { type: "output", text: "done\r\n" },
    ];
    const a = compileCast(steps, { timestamp: 42 });
    const b = compileCast(steps, { timestamp: 42 });
    assert.equal(a, b);
  });

  it("skips empty wait payloads but keeps later event timing", () => {
    const jsonl = compileCast(
      [
        { type: "wait", seconds: 2 },
        { type: "output", text: "late" },
      ],
      { timestamp: 0 },
    );
    const events = jsonl
      .trimEnd()
      .split("\n")
      .slice(1)
      .map((l) => JSON.parse(l));
    assert.equal(events.length, 1);
    assert.equal(events[0][2], "late");
    assert.ok(events[0][0] >= 2);
  });

  it("preserves trailing wait in cast duration via a no-op event", () => {
    const jsonl = compileCast(
      [
        { type: "output", text: "done" },
        { type: "wait", seconds: 6 },
      ],
      { timestamp: 0 },
    );
    const events = jsonl
      .trimEnd()
      .split("\n")
      .slice(1)
      .map((l) => JSON.parse(l));
    assert.equal(events.length, 2);
    assert.equal(events[0][2], "done");
    assert.equal(events[1][2], "");
    assert.ok(events[1][0] >= events[0][0] + 6);
  });
});
