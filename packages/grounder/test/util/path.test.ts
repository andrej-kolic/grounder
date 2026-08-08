import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandHome, isPathInside, resolveUserPath } from "../../src/util/path.js";

describe("util/path", () => {
  describe("expandHome", () => {
    it("expands bare ~ to homedir", () => {
      expect(expandHome("~")).toBe(os.homedir());
    });

    it("expands ~/… to under homedir", () => {
      expect(expandHome("~/Documents/obsidian/dev")).toBe(
        path.join(os.homedir(), "Documents/obsidian/dev"),
      );
    });

    it("leaves absolute and relative paths unchanged", () => {
      expect(expandHome("/tmp/vault")).toBe("/tmp/vault");
      expect(expandHome("relative/vault")).toBe("relative/vault");
    });

    it("does not expand a mid-path ~", () => {
      const broken = "/Users/me/dev/rey/grounder/~/Documents/obsidian/dev";
      expect(expandHome(broken)).toBe(broken);
    });
  });

  describe("resolveUserPath", () => {
    it("expands ~ then resolves to absolute", () => {
      expect(resolveUserPath("~/Documents/obsidian/dev")).toBe(
        path.join(os.homedir(), "Documents/obsidian/dev"),
      );
    });

    it("resolves relative paths against cwd", () => {
      expect(resolveUserPath("vault", "/tmp")).toBe(path.resolve("/tmp", "vault"));
    });
  });

  describe("isPathInside", () => {
    it("accepts the parent itself and nested children", () => {
      expect(isPathInside("/vault/plans", "/vault/plans")).toBe(true);
      expect(isPathInside("/vault/plans", "/vault/plans/doc.md")).toBe(true);
      expect(isPathInside("/vault/plans", "/vault/plans/sub/doc.md")).toBe(true);
    });

    it("rejects siblings and parent escapes", () => {
      expect(isPathInside("/vault/plans", "/vault/plans-evil/doc.md")).toBe(false);
      expect(isPathInside("/vault/plans", "/vault/notes/doc.md")).toBe(false);
      expect(isPathInside("/vault/plans", "/vault/plans/../notes/doc.md")).toBe(false);
    });
  });
});
