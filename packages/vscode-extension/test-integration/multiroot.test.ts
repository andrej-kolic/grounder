import * as assert from "node:assert/strict";
import * as vscode from "vscode";

const EXTENSION_ID = "grounder-dev.grounder-vscode-extension";

/** Dogfooding matrix case 24 — multi-root folder grouping, against the `multiroot.code-workspace` file `.vscode-test.mjs` opens (two real linked projects, one shared vault). */

// biome-ignore lint/suspicious/noExplicitAny: GrounderNode is a plain data shape and the compiled extension ships no .d.ts, so tests treat it structurally.
type Node = any;

interface GrounderExtensionApi {
  provider: Node;
  GrounderTreeDataProvider: new () => Node;
}

async function getApi(): Promise<GrounderExtensionApi> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `expected extension ${EXTENSION_ID} to be installed`);
  return extension.isActive ? extension.exports : await extension.activate();
}

function labelOf(provider: Node, node: Node): string {
  return provider.getTreeItem(node).label;
}

suite("multi-root", () => {
  test("folder grouping: one top-level node per folder, each with its own categories", async () => {
    assert.equal(vscode.workspace.workspaceFolders?.length, 2);

    const provider: Node = (await getApi()).provider;
    const root: Node[] = await provider.getChildren();
    assert.equal(root.length, 2);
    assert.ok(root.every((n) => n.kind === "folder"));
    assert.deepEqual(
      root.map((n) => n.folder.name),
      vscode.workspace.workspaceFolders?.map((f) => f.name),
    );

    for (const folderNode of root) {
      const children: Node[] = await provider.getChildren(folderNode);
      const categoryLabels = children
        .filter((n) => n.kind === "category")
        .map((n) => labelOf(provider, n));
      assert.ok(
        categoryLabels.includes("Notes"),
        `expected a Notes category under ${folderNode.folder.name}`,
      );
      assert.ok(
        categoryLabels.includes("Handoffs"),
        `expected a Handoffs category under ${folderNode.folder.name}`,
      );
      assert.ok(
        categoryLabels.includes("Plans"),
        `expected a Plans category under ${folderNode.folder.name}`,
      );
    }
  });
});
