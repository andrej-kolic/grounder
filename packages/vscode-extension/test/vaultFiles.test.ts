import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildVaultTree,
  listExtraVaultFolders,
  listVaultRootFiles,
  splitTimestampedLabel,
  type VaultDoc,
} from "../src/vaultFiles.js";

function doc(relativePath: string): VaultDoc {
  return {
    filePath: path.join("/vault/plans", relativePath),
    relativePath,
    label: path.basename(relativePath, ".md"),
  };
}

describe("buildVaultTree", () => {
  it("nests docs under folder segments, deepest included", () => {
    const tree = buildVaultTree([
      doc("root.md"),
      doc(path.join("archive", "0.2.0 and older", "old-plan.md")),
      doc(path.join("0.6.0", "new-plan.md")),
    ]);

    expect(tree.map((n) => (n.kind === "folder" ? n.name : n.doc.label))).toEqual([
      "0.6.0",
      "archive",
      "root",
    ]);

    const archive = tree.find((n) => n.kind === "folder" && n.name === "archive");
    expect(archive?.kind).toBe("folder");
    if (archive?.kind !== "folder") throw new Error("expected folder");
    expect(archive.relativePath).toBe("archive");
    expect(archive.children).toHaveLength(1);
    const nested = archive.children[0];
    expect(nested?.kind).toBe("folder");
    if (nested?.kind !== "folder") throw new Error("expected nested folder");
    expect(nested.name).toBe("0.2.0 and older");
    expect(nested.relativePath).toBe(path.join("archive", "0.2.0 and older"));
    expect(nested.children).toEqual([
      { kind: "doc", doc: doc(path.join("archive", "0.2.0 and older", "old-plan.md")) },
    ]);
  });

  it("sorts folders case-insensitively and lists them before files at the same level", () => {
    const tree = buildVaultTree([
      doc("Zebra.md"),
      doc(path.join("apple", "leaf.md")),
      doc("banana.md"),
    ]);
    expect(tree.map((n) => (n.kind === "folder" ? n.name : n.doc.label))).toEqual([
      "apple",
      "Zebra",
      "banana",
    ]);
  });

  it("preserves the incoming (already-ranked) order of docs within a folder", () => {
    const newer = doc(path.join("notes", "newer.md"));
    const older = doc(path.join("notes", "older.md"));
    const tree = buildVaultTree([newer, older]);
    const folder = tree[0];
    expect(folder?.kind).toBe("folder");
    if (folder?.kind !== "folder") throw new Error("expected folder");
    expect(folder.children).toEqual([
      { kind: "doc", doc: newer },
      { kind: "doc", doc: older },
    ]);
  });

  it("returns an empty tree for no docs", () => {
    expect(buildVaultTree([])).toEqual([]);
  });
});

describe("splitTimestampedLabel", () => {
  it("splits a second-precision timestamped stem into date + title", () => {
    expect(splitTimestampedLabel("2026-09-05-231935-vscode-ext-steps-3-8")).toEqual({
      title: "vscode-ext-steps-3-8",
      date: "2026-09-05 23:19:35",
    });
  });

  it("splits a legacy minute-precision timestamped stem into date + title", () => {
    expect(splitTimestampedLabel("2026-08-12-2252-test-1")).toEqual({
      title: "test-1",
      date: "2026-08-12 22:52",
    });
  });

  it("falls back to the formatted date alone when there is no title slug", () => {
    expect(splitTimestampedLabel("2026-09-05-231935")).toEqual({
      title: "2026-09-05 23:19:35",
    });
  });

  it("falls back to the whole stem as the title when it isn't timestamped", () => {
    expect(splitTimestampedLabel("vscode-extension")).toEqual({ title: "vscode-extension" });
  });
});

describe("listExtraVaultFolders", () => {
  let vaultRoot: string | undefined;

  afterEach(async () => {
    if (vaultRoot) {
      await rm(vaultRoot, { recursive: true, force: true });
      vaultRoot = undefined;
    }
  });

  it("lists subfolders other than the known dirs, excluding dotfolders", async () => {
    vaultRoot = await mkdtemp(path.join(os.tmpdir(), "grounder-vault-"));
    const notesDir = path.join(vaultRoot, "notes");
    const discussionsDir = path.join(vaultRoot, "discussions");
    await mkdir(notesDir);
    await mkdir(discussionsDir);
    await mkdir(path.join(vaultRoot, ".obsidian"));

    const extra = await listExtraVaultFolders(vaultRoot, [notesDir]);
    expect(extra).toEqual([discussionsDir]);
  });

  it("sorts case-insensitively by name", async () => {
    vaultRoot = await mkdtemp(path.join(os.tmpdir(), "grounder-vault-"));
    await mkdir(path.join(vaultRoot, "Zebra"));
    await mkdir(path.join(vaultRoot, "apple"));
    const extra = await listExtraVaultFolders(vaultRoot, []);
    expect(extra.map((dir) => path.basename(dir))).toEqual(["apple", "Zebra"]);
  });

  it("returns an empty list for a missing vault root", async () => {
    expect(await listExtraVaultFolders("/nonexistent/vault/root", [])).toEqual([]);
  });
});

describe("listVaultRootFiles", () => {
  let vaultRoot: string | undefined;

  afterEach(async () => {
    if (vaultRoot) {
      await rm(vaultRoot, { recursive: true, force: true });
      vaultRoot = undefined;
    }
  });

  it("lists .md files directly in the vault root, excluding dotfiles and non-.md files", async () => {
    vaultRoot = await mkdtemp(path.join(os.tmpdir(), "grounder-vault-"));
    await writeFile(path.join(vaultRoot, "readme.md"), "hi");
    await writeFile(path.join(vaultRoot, "notes.txt"), "hi");
    await writeFile(path.join(vaultRoot, ".hidden.md"), "hi");

    const files = await listVaultRootFiles(vaultRoot);
    expect(files.map((f) => f.label)).toEqual(["readme"]);
  });

  it("doesn't recurse into subfolders", async () => {
    vaultRoot = await mkdtemp(path.join(os.tmpdir(), "grounder-vault-"));
    const notesDir = path.join(vaultRoot, "notes");
    await mkdir(notesDir);
    await writeFile(path.join(notesDir, "nested.md"), "hi");
    await writeFile(path.join(vaultRoot, "root.md"), "hi");

    const files = await listVaultRootFiles(vaultRoot);
    expect(files.map((f) => f.label)).toEqual(["root"]);
  });

  it("returns an empty list for a missing vault root", async () => {
    expect(await listVaultRootFiles("/nonexistent/vault/root")).toEqual([]);
  });
});
