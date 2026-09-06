import * as vscode from "vscode";
import type { GrounderNode } from "./treeProvider.js";

/**
 * Carries the spike's drag pattern (`text/uri-list`, confirmed working in
 * real Cursor / VS Code / Claude Code — see the plan's Step 1 result) over to
 * real tree items. Only `doc` nodes are draggable; folder/category/action/
 * message nodes carry no file to attach.
 *
 * Single-item only: `text/uri-list` multi-select drag only honors the first
 * URI (microsoft/vscode#195048), a known VS Code limitation, not something
 * fixable here.
 */
export class GrounderDragAndDropController
  implements vscode.TreeDragAndDropController<GrounderNode>
{
  readonly dragMimeTypes = ["text/uri-list"];
  readonly dropMimeTypes: readonly string[] = [];

  handleDrag(source: readonly GrounderNode[], dataTransfer: vscode.DataTransfer): void {
    const item = source.find((node) => node.kind === "doc");
    if (item?.kind !== "doc") {
      return;
    }
    const uri = vscode.Uri.file(item.doc.filePath);
    dataTransfer.set("text/uri-list", new vscode.DataTransferItem(uri.toString()));
  }
}
