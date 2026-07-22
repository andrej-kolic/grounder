import { describe, expect, it } from "vitest";
import { yamlDoubleQuoted } from "../../src/util/yaml.js";

describe("util/yaml", () => {
  it("double-quotes plain values", () => {
    expect(yamlDoubleQuoted("my-app")).toBe('"my-app"');
  });

  it("escapes quotes, backslashes, and newlines", () => {
    expect(yamlDoubleQuoted('say "hi"')).toBe('"say \\"hi\\""');
    expect(yamlDoubleQuoted("a\\b")).toBe('"a\\\\b"');
    expect(yamlDoubleQuoted("a\nb")).toBe('"a\\nb"');
  });

  it("keeps colon and hash values parseable as a single scalar", () => {
    expect(yamlDoubleQuoted("foo: bar")).toBe('"foo: bar"');
    expect(yamlDoubleQuoted("# draft")).toBe('"# draft"');
  });
});
