import * as assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";
import { waitFor } from "./quickPickHarness.js";

const EXTENSION_ID = "grounder-dev.grounder-vscode-extension";

/**
 * Steps 3-8 dogfooding matrix cases 1-6 (tree structure), 7-9 (settings),
 * 10-12 (open), 14-16 (copy), 26-27 (live refresh, refresh/collapse-all)
 * against a real linked project + vault built by `.vscode-test.mjs`'s
 * `buildLinkedFixture` via the actual CLI. Case 24 (multi-root) lives in
 * `multiroot.test.ts` — it needs its own two-folder workspace.
 *
 * Case 9 (revealOnOpen) isn't covered here — its only call site
 * (`revealInTree` in `commands.ts`) fires from the search QuickPick's accept
 * handler, so it needs the same QuickPick-driving harness as cases 20-23/25
 * (10d), not a standalone settings toggle.
 */

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

function findCategory(provider: Node, nodes: Node[], categoryLabel: string): Node {
  const node = nodes.find((n) => n.kind === "category" && labelOf(provider, n) === categoryLabel);
  assert.ok(node, `expected a "${categoryLabel}" category among root children`);
  return node;
}

suite("tree structure", () => {
  let provider: Node;
  let root: Node[];

  suiteSetup(async () => {
    const api = await getApi();
    provider = api.provider;
    root = await provider.getChildren();
  });

  test("basic categories: Notes/Handoffs/Plans plus a Discussions category", () => {
    findCategory(provider, root, "Notes");
    findCategory(provider, root, "Handoffs");
    findCategory(provider, root, "Plans");
    findCategory(provider, root, "Discussions");
  });

  test("nested folders: subfolders sort before files, case-insensitive alpha", async () => {
    const notes = findCategory(provider, root, "Notes");
    const children: Node[] = await provider.getChildren(notes);
    assert.equal(children[0].kind, "vaultFolder");
    assert.equal(children[1].kind, "vaultFolder");
    assert.equal(children[2].kind, "doc");
    assert.deepEqual(
      children.slice(0, 2).map((n) => n.name),
      ["Archive", "topics"],
    );
  });

  test("handoff sort: newest-basename-first", async () => {
    const handoffs = findCategory(provider, root, "Handoffs");
    const children: Node[] = await provider.getChildren(handoffs);
    assert.deepEqual(
      children.map((n) => n.doc.label),
      ["2026-01-02-1000-second-handoff", "2026-01-01-1000-first-handoff"],
    );
  });

  test("plans sort: newest-mtime-first", async () => {
    const plans = findCategory(provider, root, "Plans");
    const children: Node[] = await provider.getChildren(plans);
    // alpha-plan.md is given the newer mtime despite sorting after beta-plan
    // alphabetically — proves this order comes from mtime, not from
    // sortByMtimeDesc's name-descending tie-break (which would put beta
    // first regardless of mtime).
    assert.deepEqual(
      children.map((n) => n.doc.label),
      ["alpha-plan", "beta-plan"],
    );
  });

  test("vault-root loose files: shown at top level, not nested under a category", () => {
    const rootDocs = root.filter((n) => n.kind === "doc");
    // root-doc-1.md is given the newer mtime despite sorting after
    // root-doc-2.md alphabetically — same mtime-vs-tie-break proof as plans.
    assert.deepEqual(
      rootDocs.map((n) => n.doc.label),
      ["root-doc-1", "root-doc-2"],
    );
  });

  test("dotfiles are filtered: no .hidden-note.md, no .obsidian folder", () => {
    const rootLabels = root.map((n) => (n.kind === "doc" ? n.doc.label : labelOf(provider, n)));
    assert.ok(!rootLabels.some((l: string) => l.startsWith(".")));
  });
});

suite("settings", () => {
  // biome-ignore lint/suspicious/noExplicitAny: constructor type has no .d.ts here (see getApi).
  let ProviderClass: any;

  suiteSetup(async () => {
    ProviderClass = (await getApi()).GrounderTreeDataProvider;
  });

  async function setConfig(key: string, value: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration("grounder")
      .update(key, value, vscode.ConfigurationTarget.Global);
  }

  teardown(async () => {
    await setConfig("dimDates", true);
    await setConfig("showAllVaultItems", true);
  });

  test("dimDates off shows the full timestamped stem, no separate date", async () => {
    await setConfig("dimDates", false);
    const provider: Node = new ProviderClass();
    try {
      const root: Node[] = await provider.getChildren();
      const handoffs = findCategory(provider, root, "Handoffs");
      const [newest] = await provider.getChildren(handoffs);
      const item = provider.getTreeItem(newest);
      assert.equal(item.label, "2026-01-02-1000-second-handoff");
      assert.equal(item.description, undefined);
    } finally {
      provider.dispose();
    }
  });

  test("showAllVaultItems off hides the Discussions category and loose root files", async () => {
    await setConfig("showAllVaultItems", false);
    const provider: Node = new ProviderClass();
    try {
      const root: Node[] = await provider.getChildren();
      assert.ok(!root.some((n) => n.kind === "category" && labelOf(provider, n) === "Discussions"));
      assert.ok(!root.some((n) => n.kind === "doc"));
    } finally {
      provider.dispose();
    }
  });
});

// `grounder.open`/`openToSide`/`openPreview*`'s registered handlers discard
// their own promise (`void openDoc(node)`, see `commands.ts`) so VS Code
// doesn't treat a slow open as a "slow command" — `executeCommand` for these
// resolves before the editor/webview actually opens. `waitFor` (from
// quickPickHarness.js) polls for the effect instead of trusting the
// command's own resolution.

suite("open commands", () => {
  let generalNoteNode: Node;
  let deepDiveNode: Node;

  suiteSetup(async () => {
    const provider: Node = (await getApi()).provider;
    const root: Node[] = await provider.getChildren();
    const notes = findCategory(provider, root, "Notes");
    const children: Node[] = await provider.getChildren(notes);
    generalNoteNode = children.find((n) => n.kind === "doc" && n.doc.label === "general-note");
    const topicsFolder = children.find((n) => n.kind === "vaultFolder" && n.name === "topics");
    const topicsChildren: Node[] = await provider.getChildren(topicsFolder);
    deepDiveNode = topicsChildren.find((n) => n.kind === "doc" && n.doc.label === "deep-dive");
    assert.ok(generalNoteNode && deepDiveNode);
  });

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("click doc: opens it in the active editor", async () => {
    await vscode.commands.executeCommand("grounder.open", generalNoteNode);
    await waitFor(
      () => vscode.window.activeTextEditor?.document.uri.fsPath === generalNoteNode.doc.filePath,
    );
    assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, generalNoteNode.doc.filePath);
  });

  test("open to the side: opens in a second editor group", async () => {
    await vscode.commands.executeCommand("grounder.open", generalNoteNode);
    await waitFor(
      () => vscode.window.activeTextEditor?.document.uri.fsPath === generalNoteNode.doc.filePath,
    );
    await vscode.commands.executeCommand("grounder.openToSide", deepDiveNode);
    await waitFor(
      () => vscode.window.activeTextEditor?.document.uri.fsPath === deepDiveNode.doc.filePath,
    );
    assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, deepDiveNode.doc.filePath);
    assert.ok(vscode.window.tabGroups.all.length >= 2);
  });

  test("open preview (+ to side): renders a markdown preview, not raw source", async () => {
    await vscode.commands.executeCommand("grounder.openPreview", generalNoteNode);
    await waitFor(() =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .some((tab) => tab.input instanceof vscode.TabInputWebview),
    );
    await vscode.commands.executeCommand("grounder.openPreviewToSide", deepDiveNode);
    await waitFor(() => vscode.window.tabGroups.all.length >= 2);
    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
    assert.ok(tabs.some((tab) => tab.input instanceof vscode.TabInputWebview));
  });
});

suite("copy commands", () => {
  let deepDiveNode: Node;
  let workspaceFolder: vscode.WorkspaceFolder;

  suiteSetup(async () => {
    const provider: Node = (await getApi()).provider;
    const root: Node[] = await provider.getChildren();
    const notes = findCategory(provider, root, "Notes");
    const children: Node[] = await provider.getChildren(notes);
    const topicsFolder = children.find((n) => n.kind === "vaultFolder" && n.name === "topics");
    const topicsChildren: Node[] = await provider.getChildren(topicsFolder);
    deepDiveNode = topicsChildren.find((n) => n.kind === "doc" && n.doc.label === "deep-dive");
    assert.ok(deepDiveNode);
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "expected a workspace folder to be open");
    workspaceFolder = folder;
  });

  test("copy path vs copy relative path", async () => {
    await vscode.commands.executeCommand("grounder.copyPath", deepDiveNode);
    assert.equal(await vscode.env.clipboard.readText(), deepDiveNode.doc.filePath);

    await vscode.commands.executeCommand("grounder.copyRelativePath", deepDiveNode);
    assert.equal(await vscode.env.clipboard.readText(), path.join("topics", "deep-dive.md"));
  });

  test("copy as @mention outside the workspace: absolute-path mention", async () => {
    await vscode.commands.executeCommand("grounder.copyMention", deepDiveNode);
    assert.equal(await vscode.env.clipboard.readText(), `@${deepDiveNode.doc.filePath}`);
  });

  test("copy as @mention inside the workspace: relative mention", async () => {
    const insideWorkspacePath = path.join(workspaceFolder.uri.fsPath, "in-workspace-note.md");
    await writeFile(insideWorkspacePath, "# In workspace\n");
    const node: Node = {
      kind: "doc",
      doc: {
        filePath: insideWorkspacePath,
        relativePath: "in-workspace-note.md",
        label: "in-workspace-note",
      },
      dir: workspaceFolder.uri.fsPath,
      folder: workspaceFolder,
    };
    await vscode.commands.executeCommand("grounder.copyMention", node);
    assert.equal(await vscode.env.clipboard.readText(), "@in-workspace-note.md");
  });
});

/** Waits for `provider.onDidChangeTreeData` to fire once, or for mocha's own test timeout to fail the test. */
function onceTreeDataChanged(provider: Node): Promise<void> {
  return new Promise((resolve) => {
    const disposable = provider.onDidChangeTreeData(() => {
      disposable.dispose();
      resolve();
    });
  });
}

suite("live refresh and controls", () => {
  let provider: Node;

  suiteSetup(async () => {
    provider = (await getApi()).provider;
    // Establishes the category-dir file watchers (childrenForFolder's
    // watchDir calls) before the file-watcher test below touches one.
    await provider.getChildren();
  });

  test("file watcher: adding a file refreshes the tree without a manual refresh", async () => {
    const root: Node[] = await provider.getChildren();
    const notes = findCategory(provider, root, "Notes");
    // scheduleRefresh debounces file-watcher events by 300ms. Poll the
    // actual visible effect rather than a single onDidChangeTreeData fire —
    // the live provider also watches ~/.grounder and the settings suite's
    // config updates fire the same event, so "the first fire after this
    // write" isn't reliably *this* write's fire.
    await writeFile(path.join(notes.dir, "live-refresh-note.md"), "# Live refresh\n");
    await waitFor(async () => {
      const children: Node[] = await provider.getChildren(notes);
      return children.some((n) => n.kind === "doc" && n.doc.label === "live-refresh-note");
    });
  });

  test("refresh command triggers a tree data change", async () => {
    const changed = onceTreeDataChanged(provider);
    await vscode.commands.executeCommand("grounder.refresh");
    await changed;
  });

  test("collapse-all command executes without throwing", async () => {
    await vscode.commands.executeCommand("grounder.collapseAll");
  });
});
