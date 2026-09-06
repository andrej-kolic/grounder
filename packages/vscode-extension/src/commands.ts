import path from "node:path";
import * as vscode from "vscode";
import { type CliResult, invokeCli } from "./cli.js";
import { fetchStatus, type StatusProject } from "./status.js";
import type { GrounderNode, GrounderTreeDataProvider } from "./treeProvider.js";

interface SearchHit {
  file: string;
  relativePath: string;
  alsoMatchedHint: string;
}

interface SearchPayload {
  totalMatchCount: number;
  hits: SearchHit[];
}

function parseSearchJson(raw: string): SearchPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SearchPayload>;
    if (typeof parsed.totalMatchCount !== "number" || !Array.isArray(parsed.hits)) {
      return null;
    }
    return { totalMatchCount: parsed.totalMatchCount, hits: parsed.hits as SearchHit[] };
  } catch {
    return null;
  }
}

/** `@relative/path` when `uri` sits inside an open workspace folder, else `@<absolute path>`. */
function mentionText(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder) {
    return `@${vscode.workspace.asRelativePath(uri, false)}`;
  }
  return `@${uri.fsPath}`;
}

async function copyMentionForUri(uri: vscode.Uri): Promise<void> {
  const text = mentionText(uri);
  await vscode.env.clipboard.writeText(text);
  vscode.window.showInformationMessage(`Copied ${text} to clipboard`);
}

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showErrorMessage("Open a folder to use Grounder.");
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }
  const pick = await vscode.window.showQuickPick(
    folders.map((folder) => ({ label: folder.name, folder })),
    { placeHolder: "Search which project's vault?" },
  );
  return pick?.folder;
}

function reportCliFailure(result: Exclude<CliResult, { kind: "ok" }>): void {
  if (result.kind === "no-runtime") {
    vscode.window.showErrorMessage("Grounder CLI not installed. Run `grounder setup` first.");
    return;
  }
  vscode.window.showErrorMessage(
    `grounder failed: ${result.stderr.trim() || `exit code ${result.code}`}`,
  );
}

async function linkProject(
  folder: vscode.WorkspaceFolder,
  provider: GrounderTreeDataProvider,
): Promise<void> {
  const result = await invokeCli(["link", "--yes"], { cwd: folder.uri.fsPath });
  if (result.kind !== "ok") {
    reportCliFailure(result);
    return;
  }
  vscode.window.showInformationMessage(`Linked "${folder.name}" to the Grounder vault.`);
  provider.refresh();
}

function showSetupHint(): void {
  const terminal = vscode.window.createTerminal("Grounder Setup");
  terminal.show();
  terminal.sendText("grounder setup");
}

/**
 * Each toggle is registered under two command ids (see `registerCommands`),
 * one per state, shown/hidden by complementary `when` clauses on the config
 * value — the menu item's title is the only way to convey checked state for
 * a `view/title` entry, since this Cursor build renders no checkmark at all
 * for the native `toggled` menu-item property.
 */
async function toggleDimDates(): Promise<void> {
  const config = vscode.workspace.getConfiguration("grounder");
  const current = config.get<boolean>("dimDates", true);
  await config.update("dimDates", !current, vscode.ConfigurationTarget.Global);
}

async function toggleShowAllVaultItems(): Promise<void> {
  const config = vscode.workspace.getConfiguration("grounder");
  const current = config.get<boolean>("showAllVaultItems", true);
  await config.update("showAllVaultItems", !current, vscode.ConfigurationTarget.Global);
}

async function toggleRevealOnOpen(): Promise<void> {
  const config = vscode.workspace.getConfiguration("grounder");
  const current = config.get<boolean>("revealOnOpen", true);
  await config.update("revealOnOpen", !current, vscode.ConfigurationTarget.Global);
}

/**
 * Maps an absolute doc path back to its vault category dir, using
 * `status --json`'s dirs rather than string-matching the search hit's
 * `relativePath` segment — robust to whatever those dirs happen to be
 * physically named. Falls back to the doc's immediate parent under
 * `vaultRoot` for a doc found in an extra (non notes/logs/plans) folder,
 * e.g. a hand-made `discussions/` dir (see `listExtraVaultFolders`), or to
 * `vaultRoot` itself for a doc sitting directly in it (see
 * `listVaultRootFiles`).
 */
function categoryDirFor(fileAbsolutePath: string, project: StatusProject): string | null {
  const known = [project.notesDir, project.logsDir, project.plansDir].filter(
    (dir): dir is string => dir !== null,
  );
  for (const dir of known) {
    if (fileAbsolutePath === dir || fileAbsolutePath.startsWith(dir + path.sep)) {
      return dir;
    }
  }
  if (!project.vaultRoot) {
    return null;
  }
  const relative = path.relative(project.vaultRoot, fileAbsolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  const segments = relative.split(path.sep);
  if (segments.length === 1) {
    return project.vaultRoot;
  }
  const firstSegment = segments[0];
  return firstSegment ? path.join(project.vaultRoot, firstSegment) : null;
}

/**
 * Selects `fileAbsolutePath` in the Grounder tree after it's opened outside
 * the tree itself (currently: accepting a search result) — best-effort, and
 * a no-op if `grounder.revealOnOpen` is off or the doc's category dir can't
 * be resolved (e.g. an unlinked folder).
 */
async function revealInTree(
  view: vscode.TreeView<GrounderNode>,
  folder: vscode.WorkspaceFolder,
  fileAbsolutePath: string,
): Promise<void> {
  if (!vscode.workspace.getConfiguration("grounder").get<boolean>("revealOnOpen", true)) {
    return;
  }
  const status = await fetchStatus(folder.uri.fsPath);
  if (status.kind !== "ok" || !status.payload.project.linked) {
    return;
  }
  const dir = categoryDirFor(fileAbsolutePath, status.payload.project);
  if (!dir) {
    return;
  }
  const node: GrounderNode = {
    kind: "doc",
    doc: {
      filePath: fileAbsolutePath,
      relativePath: path.relative(dir, fileAbsolutePath),
      label: path.basename(fileAbsolutePath, ".md"),
    },
    dir,
    folder,
  };
  try {
    await view.reveal(node, { select: true, focus: false, expand: true });
  } catch {
    // Best-effort — e.g. the tree hasn't rendered this category yet this session.
  }
}

async function copyMention(node?: GrounderNode): Promise<void> {
  if (node?.kind !== "doc") {
    return;
  }
  await copyMentionForUri(vscode.Uri.file(node.doc.filePath));
}

async function openDoc(node?: GrounderNode): Promise<void> {
  if (node?.kind !== "doc") {
    return;
  }
  await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(node.doc.filePath));
}

async function openToSide(node?: GrounderNode): Promise<void> {
  if (node?.kind !== "doc") {
    return;
  }
  await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(node.doc.filePath), {
    viewColumn: vscode.ViewColumn.Beside,
  });
}

async function openPreview(node: GrounderNode | undefined, toSide: boolean): Promise<void> {
  if (node?.kind !== "doc") {
    return;
  }
  await vscode.commands.executeCommand(
    toSide ? "markdown.showPreviewToSide" : "markdown.showPreview",
    vscode.Uri.file(node.doc.filePath),
  );
}

async function revealInOS(node?: GrounderNode): Promise<void> {
  if (node?.kind !== "doc") {
    return;
  }
  await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(node.doc.filePath));
}

async function copyPath(node?: GrounderNode): Promise<void> {
  if (node?.kind !== "doc") {
    return;
  }
  await vscode.env.clipboard.writeText(node.doc.filePath);
}

/**
 * `Uri.asRelativePath` falls back to the absolute path outside any open
 * workspace folder, which the vault always is by design — so this copies
 * the path relative to the doc's vault category dir (`node.doc.relativePath`,
 * already computed by `listVaultDocs`) instead, which is actually distinct
 * from "Copy Path".
 */
async function copyRelativePath(node?: GrounderNode): Promise<void> {
  if (node?.kind !== "doc") {
    return;
  }
  await vscode.env.clipboard.writeText(node.doc.relativePath);
}

async function runSearch(
  view: vscode.TreeView<GrounderNode>,
  folderArg?: vscode.WorkspaceFolder,
): Promise<void> {
  const folder = folderArg ?? (await pickWorkspaceFolder());
  if (!folder) {
    return;
  }

  const query = await vscode.window.showInputBox({
    prompt: `Search the "${folder.name}" vault`,
    placeHolder: "query",
  });
  if (!query) {
    return;
  }

  const result = await invokeCli(["search", query, "--json"], { cwd: folder.uri.fsPath });
  if (result.kind !== "ok") {
    reportCliFailure(result);
    return;
  }

  const payload = parseSearchJson(result.stdout);
  if (!payload) {
    vscode.window.showErrorMessage("Could not parse `grounder search --json` output.");
    return;
  }
  if (payload.totalMatchCount === 0) {
    // A transient showInformationMessage toast auto-dismisses and is easy to
    // miss, reading as "search did nothing" for an empty-result query — an
    // empty QuickPick with the message as its placeholder stays up until the
    // user dismisses it, same as VS Code's own Quick Open empty state.
    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = `No matches for "${query}"`;
    quickPick.items = [];
    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
    return;
  }

  const copyButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("clippy"),
    tooltip: "Copy as @mention",
  };

  const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { hit: SearchHit }>();
  quickPick.placeholder = `${payload.hits.length} result(s) for "${query}"`;
  quickPick.items = payload.hits.map((hit) => ({
    label: hit.alsoMatchedHint,
    detail: hit.relativePath,
    buttons: [copyButton],
    hit,
  }));

  quickPick.onDidTriggerItemButton(async (event) => {
    await copyMentionForUri(vscode.Uri.file(event.item.hit.file));
  });
  quickPick.onDidAccept(async () => {
    const [selected] = quickPick.selectedItems;
    if (selected) {
      await vscode.window.showTextDocument(vscode.Uri.file(selected.hit.file));
      void revealInTree(view, folder, selected.hit.file);
    }
    quickPick.hide();
  });
  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();
}

export function registerCommands(
  context: vscode.ExtensionContext,
  provider: GrounderTreeDataProvider,
  view: vscode.TreeView<GrounderNode>,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("grounder.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("grounder.collapseAll", () =>
      vscode.commands.executeCommand("workbench.actions.treeView.grounderVault.collapseAll"),
    ),
    vscode.commands.registerCommand(
      "grounder.linkProject",
      (node?: GrounderNode | vscode.WorkspaceFolder) => {
        const folder =
          node && "folder" in node ? node.folder : (node as vscode.WorkspaceFolder | undefined);
        if (folder) {
          void linkProject(folder, provider);
        }
      },
    ),
    vscode.commands.registerCommand("grounder.showSetupHint", () => showSetupHint()),
    vscode.commands.registerCommand("grounder.toggleDimDatesOn", () => void toggleDimDates()),
    vscode.commands.registerCommand("grounder.toggleDimDatesOff", () => void toggleDimDates()),
    vscode.commands.registerCommand(
      "grounder.toggleShowAllVaultItemsOn",
      () => void toggleShowAllVaultItems(),
    ),
    vscode.commands.registerCommand(
      "grounder.toggleShowAllVaultItemsOff",
      () => void toggleShowAllVaultItems(),
    ),
    vscode.commands.registerCommand(
      "grounder.toggleRevealOnOpenOn",
      () => void toggleRevealOnOpen(),
    ),
    vscode.commands.registerCommand(
      "grounder.toggleRevealOnOpenOff",
      () => void toggleRevealOnOpen(),
    ),
    vscode.commands.registerCommand(
      "grounder.copyMention",
      (node?: GrounderNode) => void copyMention(node),
    ),
    vscode.commands.registerCommand("grounder.open", (node?: GrounderNode) => void openDoc(node)),
    vscode.commands.registerCommand(
      "grounder.openToSide",
      (node?: GrounderNode) => void openToSide(node),
    ),
    vscode.commands.registerCommand(
      "grounder.openPreview",
      (node?: GrounderNode) => void openPreview(node, false),
    ),
    vscode.commands.registerCommand(
      "grounder.openPreviewToSide",
      (node?: GrounderNode) => void openPreview(node, true),
    ),
    vscode.commands.registerCommand(
      "grounder.revealInOS",
      (node?: GrounderNode) => void revealInOS(node),
    ),
    vscode.commands.registerCommand(
      "grounder.copyPath",
      (node?: GrounderNode) => void copyPath(node),
    ),
    vscode.commands.registerCommand(
      "grounder.copyRelativePath",
      (node?: GrounderNode) => void copyRelativePath(node),
    ),
    vscode.commands.registerCommand(
      "grounder.search",
      (node?: GrounderNode | vscode.WorkspaceFolder) => {
        const folder =
          node && "folder" in node ? node.folder : (node as vscode.WorkspaceFolder | undefined);
        void runSearch(view, folder);
      },
    ),
  );
}
