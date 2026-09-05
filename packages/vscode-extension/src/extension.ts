import * as vscode from "vscode";

/**
 * Single hardcoded tree item pointing at this package's own README.md —
 * a real file, just to have a concrete drag target for the spike.
 */
class SpikeTreeItem extends vscode.TreeItem {
  constructor(readonly resourceUri: vscode.Uri) {
    super(resourceUri, vscode.TreeItemCollapsibleState.None);
    this.command = {
      command: "vscode.open",
      title: "Open",
      arguments: [resourceUri],
    };
  }
}

class SpikeTreeDataProvider implements vscode.TreeDataProvider<SpikeTreeItem> {
  constructor(private readonly readmeUri: vscode.Uri) {}

  getTreeItem(element: SpikeTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SpikeTreeItem): SpikeTreeItem[] {
    if (element) {
      return [];
    }
    return [new SpikeTreeItem(this.readmeUri)];
  }
}

/**
 * Tests the load-bearing assumption for the whole extension: does dropping
 * a text/uri-list payload land in Cursor's or Claude Code's chat panel?
 */
class SpikeDragAndDropController implements vscode.TreeDragAndDropController<SpikeTreeItem> {
  readonly dragMimeTypes = ["text/uri-list"];
  readonly dropMimeTypes: readonly string[] = [];

  handleDrag(source: readonly SpikeTreeItem[], dataTransfer: vscode.DataTransfer): void {
    const [item] = source;
    if (!item) {
      return;
    }
    dataTransfer.set("text/uri-list", new vscode.DataTransferItem(item.resourceUri.toString()));
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const readmeUri = vscode.Uri.joinPath(context.extensionUri, "README.md");
  const treeDataProvider = new SpikeTreeDataProvider(readmeUri);

  const view = vscode.window.createTreeView("grounderSpike", {
    treeDataProvider,
    dragAndDropController: new SpikeDragAndDropController(),
  });

  context.subscriptions.push(view);
}

export function deactivate(): void {}
