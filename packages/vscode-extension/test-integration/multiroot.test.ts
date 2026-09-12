import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  interceptQuickPick,
  stubShowInputBox,
  stubShowQuickPick,
  waitFor,
} from "./quickPickHarness.js";

const EXTENSION_ID = "grounder.grounder-vscode-extension";

// biome-ignore lint/suspicious/noExplicitAny: GrounderNode/QuickPickItem are plain data shapes and the compiled extension ships no .d.ts, so tests treat them structurally.
type Node = any;

interface GrounderExtensionApi {
  provider: Node;
  GrounderTreeDataProvider: new () => Node;
  view: Node;
}

async function getApi(): Promise<GrounderExtensionApi> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `expected extension ${EXTENSION_ID} to be installed`);
  return extension.isActive ? extension.exports : await extension.activate();
}

function labelOf(provider: Node, node: Node): string {
  return provider.getTreeItem(node).label;
}

/**
 * Against the `multiroot.code-workspace` file `.vscode-test.mjs` opens: two
 * real linked projects ("fixture-one", "fixture-two") sharing one vault.
 */
suite("multi-root", () => {
  test("folder grouping (case 24): one top-level node per folder, each with its own categories", async () => {
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

  test("search folder picker (case 25): asks which project, then searches only that vault", async () => {
    const restoreQuickPick = stubShowQuickPick(vscode, (items: readonly Node[]) => {
      const picked = items.find((item) => item.folder.name === "fixture-two");
      assert.ok(picked, "expected a QuickPick item for fixture-two");
      return picked;
    });
    const restoreInput = stubShowInputBox(vscode, "second project");
    const intercept = interceptQuickPick(vscode);
    try {
      await vscode.commands.executeCommand("grounder.search");
      await waitFor(() => intercept.getQuickPick() !== undefined);
      const quickPick = intercept.getQuickPick();
      await waitFor(() => quickPick.items.length > 0);
      assert.ok(
        quickPick.items.every((item: Node) =>
          item.hit.file.includes("grounder-vscode-test-fixture-two"),
        ),
        "expected every hit to come from fixture-two's project vault",
      );
    } finally {
      intercept.getQuickPick()?.dispose();
      restoreQuickPick();
      restoreInput();
      intercept.restore();
    }
  });
});
