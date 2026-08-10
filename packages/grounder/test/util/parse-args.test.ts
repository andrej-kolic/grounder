import { describe, expect, it } from "vitest";
import { flagBool, flagString, flagStrings, parseArgs } from "../../src/util/parse-args.js";

function mapsOf(argv: string[]) {
  const { positional, flags, repeated } = parseArgs(argv);
  return {
    positional,
    flags: Object.fromEntries(flags),
    repeated: Object.fromEntries(repeated),
  };
}

describe("util/parse-args", () => {
  it("parses long options with values and booleans", () => {
    expect(mapsOf(["body", "--title", "my-plan", "--force"])).toEqual({
      positional: ["body"],
      flags: { title: "my-plan", force: true },
      repeated: { title: ["my-plan"] },
    });
  });

  it("parses hyphenated long options like --dry-run", () => {
    expect(mapsOf(["--dry-run", "--agent", "cursor"])).toEqual({
      positional: [],
      flags: { "dry-run": true, agent: "cursor" },
      repeated: { agent: ["cursor"] },
    });
  });

  it("parses short options", () => {
    expect(mapsOf(["-fy"])).toEqual({
      positional: [],
      flags: { f: true, y: true },
      repeated: {},
    });
  });

  it("keeps markdown bullet bodies starting with a single dash as positional", () => {
    const body = "- a markdown bullet\n- another";
    expect(mapsOf([body, "--title", "my-note"])).toEqual({
      positional: [body],
      flags: { title: "my-note" },
      repeated: { title: ["my-note"] },
    });
  });

  it("does not treat malformed short tokens as flags", () => {
    expect(mapsOf(["-1", "- item", "-."]).positional).toEqual(["-1", "- item", "-."]);
  });

  it("keeps YAML frontmatter bodies starting with --- as positional", () => {
    const body = "---\ntitle: x\n---\n\n# Plan";
    expect(mapsOf([body, "--title", "my-plan"])).toEqual({
      positional: [body],
      flags: { title: "my-plan" },
      repeated: { title: ["my-plan"] },
    });
  });

  it("keeps a bare --- token as positional", () => {
    expect(mapsOf(["---", "--title", "my-plan"])).toEqual({
      positional: ["---"],
      flags: { title: "my-plan" },
      repeated: { title: ["my-plan"] },
    });
  });

  it("keeps frontmatter bodies after flags as positional", () => {
    const body = "---\nbody";
    expect(mapsOf(["--title", "my-plan", body])).toEqual({
      positional: [body],
      flags: { title: "my-plan" },
      repeated: { title: ["my-plan"] },
    });
  });

  it("treats -- as end-of-options so later tokens stay positional", () => {
    expect(mapsOf(["--title", "x", "--", "---\nbody", "--force"])).toEqual({
      positional: ["---\nbody", "--force"],
      flags: { title: "x" },
      repeated: { title: ["x"] },
    });
  });

  it("does not treat malformed -- tokens as flags", () => {
    expect(mapsOf(["--", "kept"]).positional).toEqual(["kept"]);
    expect(mapsOf(["--1", "a"]).positional).toEqual(["--1", "a"]);
    expect(mapsOf(["---extra"]).positional).toEqual(["---extra"]);
  });

  it("flag helpers read bool, string, and repeated values", () => {
    const { flags, repeated } = parseArgs([
      "--force",
      "--title",
      "a",
      "--agent",
      "cursor",
      "--agent",
      "claude",
    ]);
    expect(flagBool(flags, "force")).toBe(true);
    expect(flagBool(flags, "missing")).toBe(false);
    expect(flagString(flags, "title")).toBe("a");
    expect(flagStrings(repeated, "agent")).toEqual(["cursor", "claude"]);
  });
});
