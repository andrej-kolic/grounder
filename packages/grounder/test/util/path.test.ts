import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  escapeMarkdownLinkLabel,
  expandHome,
  formatMarkdownFileLink,
  isPathInside,
  isRealPathInside,
  resolveUserPath,
  toFileUri,
  vaultItemPlainTitle,
  vaultRelativePath,
} from "../../src/util/path.js";

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

  describe("isRealPathInside", () => {
    let tmp: string | undefined;

    afterEach(async () => {
      if (tmp) {
        await rm(tmp, { recursive: true, force: true });
        tmp = undefined;
      }
    });

    it("rejects a symlink under parent that points outside", async () => {
      tmp = await mkdtemp(path.join(os.tmpdir(), "grounder-realpath-"));
      const parent = path.join(tmp, "plans");
      const outside = path.join(tmp, "outside.md");
      const link = path.join(parent, "escape.md");
      await mkdir(parent);
      await writeFile(outside, "x", "utf8");
      await symlink(outside, link);

      expect(isPathInside(parent, link)).toBe(true);
      expect(await isRealPathInside(parent, link)).toBe(false);
    });

    it("accepts a real file under parent", async () => {
      tmp = await mkdtemp(path.join(os.tmpdir(), "grounder-realpath-"));
      const parent = path.join(tmp, "plans");
      const file = path.join(parent, "doc.md");
      await mkdir(parent);
      await writeFile(file, "x", "utf8");

      expect(await isRealPathInside(parent, file)).toBe(true);
    });

    it("returns null when the child is missing", async () => {
      tmp = await mkdtemp(path.join(os.tmpdir(), "grounder-realpath-"));
      const parent = path.join(tmp, "plans");
      await mkdir(parent);

      expect(await isRealPathInside(parent, path.join(parent, "missing.md"))).toBe(null);
    });
  });

  describe("toFileUri", () => {
    it("matches pathToFileURL href", () => {
      const filePath = "/tmp/vault/plans/doc 1.md";
      expect(toFileUri(filePath)).toBe(pathToFileURL(filePath).href);
    });
  });

  describe("escapeMarkdownLinkLabel", () => {
    it("escapes backslashes and brackets", () => {
      expect(escapeMarkdownLinkLabel("a[b]c\\d")).toBe("a\\[b\\]c\\\\d");
    });
  });

  describe("formatMarkdownFileLink", () => {
    it("builds a normal file link", () => {
      const filePath = "/tmp/vault/plans/phase-1.md";
      expect(formatMarkdownFileLink("phase-1.md", filePath)).toBe(
        `[phase-1.md](${pathToFileURL(filePath).href})`,
      );
    });

    it("escapes label brackets and encodes parentheses in the URI", () => {
      // Use \u escapes so brackets/parens in the path are not tooling-mangled.
      const filePath = "/tmp/vault/plans/weird\u005b\u005d(name).md";
      const label = "weird\u005b\u005d(name).md";
      const uri = pathToFileURL(filePath).href.replace(/\(/g, "%28").replace(/\)/g, "%29");
      expect(formatMarkdownFileLink(label, filePath)).toBe(`[weird\\[\\](name).md](${uri})`);
    });
  });

  describe("vaultRelativePath", () => {
    it("uses forward slashes relative to the root", () => {
      expect(vaultRelativePath("/vault/project", "/vault/project/plans/a.md")).toBe("plans/a.md");
    });
  });

  describe("vaultItemPlainTitle", () => {
    it("uses the filename stem when no root is given", () => {
      expect(vaultItemPlainTitle("/vault/plans/phase-1.md")).toBe("phase-1");
    });

    it("keeps nested folders under the title root", () => {
      expect(vaultItemPlainTitle("/vault/plans/migration/phase-1.md", "/vault/plans")).toBe(
        "migration/phase-1",
      );
    });

    it("matches basename for top-level files under the title root", () => {
      expect(vaultItemPlainTitle("/vault/plans/phase-1.md", "/vault/plans")).toBe("phase-1");
    });
  });
});
