import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { interceptQuickPick, stubShowInputBox, waitFor } from "./quickPickHarness.js";

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

// grounder search's relativePath is relative to the project vault root, not
// the category dir (unlike vaultFiles.ts's own doc.relativePath) — and, per
// util/path.ts's vaultRelativePath, always forward-slash regardless of OS.
// A path.join(...) comparison would break on Windows.
const DEEP_DIVE_RELATIVE_PATH = "notes/topics/deep-dive.md";

/**
 * Dogfooding matrix cases 20-23 (search QuickPick) plus case 9
 * (revealOnOpen) — deferred here from 10b since its only call site
 * (`revealInTree` in `commands.ts`) fires from this same accept handler.
 *
 * `grounder.search`'s registered handler discards its own promise
 * (`void runSearch(...)`, same fire-and-forget pattern as the open commands
 * in tree.test.ts), so tests wait for the intercepted QuickPick to appear
 * instead of trusting `executeCommand`'s resolution.
 */
suite("search", () => {
  suiteSetup(async () => {
    const { provider } = await getApi();
    // Populates categoryNodes (topLevelParent's lookup for TreeView.reveal)
    // before the accept/revealOnOpen test below needs it.
    await provider.getChildren();
  });

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    // The accept test below flips this on explicitly; reset regardless of
    // which test ran so later suites always see the documented default.
    await vscode.workspace
      .getConfiguration("grounder")
      .update("revealOnOpen", true, vscode.ConfigurationTarget.Global);
  });

  test("basic search: results shown with match-hint label and relative-path detail", async () => {
    const restoreInput = stubShowInputBox(vscode, "deep dive");
    const intercept = interceptQuickPick(vscode);
    try {
      await vscode.commands.executeCommand("grounder.search");
      await waitFor(() => intercept.getQuickPick() !== undefined);
      const quickPick = intercept.getQuickPick();
      await waitFor(() => quickPick.items.length > 0);
      assert.ok(quickPick.title.includes("result"), `unexpected title: ${quickPick.title}`);
      const hit = quickPick.items.find((item: Node) => item.detail === DEEP_DIVE_RELATIVE_PATH);
      assert.ok(
        hit,
        `expected a hit for ${DEEP_DIVE_RELATIVE_PATH}, got: ${JSON.stringify(quickPick.items.map((i: Node) => ({ label: i.label, detail: i.detail })))}`,
      );
    } finally {
      intercept.getQuickPick()?.dispose();
      restoreInput();
      intercept.restore();
    }
  });

  test("zero-hit state: stays open with a retry-me title, no items", async () => {
    const restoreInput = stubShowInputBox(vscode, "no-such-term-xyz123");
    const intercept = interceptQuickPick(vscode);
    try {
      await vscode.commands.executeCommand("grounder.search");
      await waitFor(() => intercept.getQuickPick() !== undefined);
      const quickPick = intercept.getQuickPick();
      await waitFor(() => typeof quickPick.title === "string" && quickPick.title.length > 0);
      assert.ok(quickPick.title.includes("No matches for"), `unexpected title: ${quickPick.title}`);
      assert.equal(quickPick.items.length, 0);
    } finally {
      intercept.getQuickPick()?.dispose();
      restoreInput();
      intercept.restore();
    }
  });

  test("copy-as-mention button: copies the hovered hit's file as an @mention", async () => {
    const restoreInput = stubShowInputBox(vscode, "deep dive");
    const intercept = interceptQuickPick(vscode);
    try {
      await vscode.commands.executeCommand("grounder.search");
      await waitFor(() => intercept.getQuickPick() !== undefined);
      const quickPick = intercept.getQuickPick();
      await waitFor(() => quickPick.items.length > 0);
      const hit = quickPick.items.find((item: Node) => item.detail === DEEP_DIVE_RELATIVE_PATH);
      assert.ok(hit);
      await intercept.getOnButton()({ item: hit });
      assert.equal(await vscode.env.clipboard.readText(), `@${hit.hit.file}`);
    } finally {
      intercept.getQuickPick()?.dispose();
      restoreInput();
      intercept.restore();
    }
  });

  test("accept: opens the doc and reveals it in the tree (case 23 + revealOnOpen)", async () => {
    await vscode.workspace
      .getConfiguration("grounder")
      .update("revealOnOpen", true, vscode.ConfigurationTarget.Global);
    const restoreInput = stubShowInputBox(vscode, "deep dive");
    const intercept = interceptQuickPick(vscode);
    try {
      const { view } = await getApi();
      await vscode.commands.executeCommand("grounder.search");
      await waitFor(() => intercept.getQuickPick() !== undefined);
      const quickPick = intercept.getQuickPick();
      await waitFor(() => quickPick.items.length > 0);
      const hit = quickPick.items.find((item: Node) => item.detail === DEEP_DIVE_RELATIVE_PATH);
      assert.ok(hit);
      quickPick.selectedItems = [hit];

      await intercept.getOnAccept()();

      await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath === hit.hit.file);
      await waitFor(() => view.selection.length > 0);
      assert.ok(view.selection.some((n: Node) => n.kind === "doc" && n.doc.label === "deep-dive"));
    } finally {
      intercept.getQuickPick()?.dispose();
      restoreInput();
      intercept.restore();
    }
  });
});
