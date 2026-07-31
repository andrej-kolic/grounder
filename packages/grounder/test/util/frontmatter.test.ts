import { describe, expect, it } from "vitest";
import { parseHandoffFrontmatter } from "../../src/util/frontmatter.js";

describe("util/frontmatter", () => {
  it("parses quoted title and created", () => {
    const content = `---
project: "my-app"
created: "2026-07-22T21:10:34.728Z"
title: "phase-2-dogfood"
---

# body
`;
    expect(parseHandoffFrontmatter(content)).toEqual({
      created: "2026-07-22T21:10:34.728Z",
      title: "phase-2-dogfood",
    });
  });

  it("parses unquoted legacy title and created", () => {
    const content = `---
project: grounder-dev
created: 2026-07-22T21:10:34.728Z
title: phase-2-dogfood
---

# body
`;
    expect(parseHandoffFrontmatter(content)).toEqual({
      created: "2026-07-22T21:10:34.728Z",
      title: "phase-2-dogfood",
    });
  });

  it("unescapes quoted backslash, quote, and newline sequences", () => {
    const content = ["---", 'title: "say \\"hi\\""', 'created: "a\\nb"', "---", ""].join("\n");
    expect(parseHandoffFrontmatter(content)).toEqual({
      title: 'say "hi"',
      created: "a\nb",
    });
  });

  it("returns {} when frontmatter is missing or incomplete", () => {
    expect(parseHandoffFrontmatter("")).toEqual({});
    expect(parseHandoffFrontmatter("# no fence\n")).toEqual({});
    expect(parseHandoffFrontmatter("---\nproject: x\n")).toEqual({});
  });

  it("ignores unrelated keys and stops at closing fence", () => {
    const content = `---
project: "my-app"
branch: "main"
created: "2026-06-26T14:30:00.000Z"
---
title: "after-close"
`;
    expect(parseHandoffFrontmatter(content)).toEqual({
      created: "2026-06-26T14:30:00.000Z",
    });
  });

  it("never throws on unexpected input", () => {
    expect(parseHandoffFrontmatter('---\ntitle: "unterminated\n---\n')).toEqual({});
    expect(parseHandoffFrontmatter("---\ncreated:\n---\n")).toEqual({});
  });
});
