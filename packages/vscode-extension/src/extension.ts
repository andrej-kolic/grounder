import * as vscode from "vscode";
import { invokeCli, MIN_CLI_VERSION, meetsMinVersion } from "./cli.js";
import { registerCommands, registerDebugCommands } from "./commands.js";
import { GrounderDragAndDropController } from "./dragAndDrop.js";
import { GrounderTreeDataProvider } from "./treeProvider.js";

/**
 * Checks the materialized runtime's version against {@link MIN_CLI_VERSION}
 * and warns (not blocks — CLI/extension ship on independent cadences, per the
 * plan's version-compatibility decision). Silent when the runtime isn't
 * installed at all — the tree already surfaces that via its own action item,
 * so a second popup here would just be noise.
 */
async function checkCliVersionFloor(): Promise<void> {
  const result = await invokeCli(["--version"]);
  if (result.kind !== "ok") {
    return;
  }
  const version = result.stdout.trim();
  if (!meetsMinVersion(version)) {
    vscode.window.showWarningMessage(
      `Grounder CLI ${version} is older than this extension expects (${MIN_CLI_VERSION}+). ` +
        "Some features may not work — re-run `grounder setup` after upgrading the package.",
    );
  }
}

/**
 * Exposed for `test-integration/` — VS Code has no generic way to read
 * another extension's rendered TreeView contents (see `commands.ts`'s
 * `debugState` comment), so tests reach the live provider via
 * `Extension.exports` instead. `GrounderTreeDataProvider` itself is also
 * exposed so a settings test can construct a throwaway instance that reads
 * `grounder.*` config fresh in its constructor, rather than racing the live
 * provider's `onDidChangeConfiguration` listener after a config update.
 */
export interface GrounderExtensionApi {
  provider: GrounderTreeDataProvider;
  GrounderTreeDataProvider: typeof GrounderTreeDataProvider;
}

export function activate(context: vscode.ExtensionContext): GrounderExtensionApi {
  const provider = new GrounderTreeDataProvider();
  const view = vscode.window.createTreeView("grounderVault", {
    treeDataProvider: provider,
    dragAndDropController: new GrounderDragAndDropController(),
  });

  registerCommands(context, provider, view);
  if (context.extensionMode === vscode.ExtensionMode.Development) {
    registerDebugCommands(context);
  }

  context.subscriptions.push(
    view,
    { dispose: () => provider.dispose() },
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
  );

  void checkCliVersionFloor();

  return { provider, GrounderTreeDataProvider };
}

export function deactivate(): void {}
