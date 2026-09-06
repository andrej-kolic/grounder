import path from "node:path";
import * as vscode from "vscode";
import { grounderHomeDir } from "./cli.js";
import { type LinkedProject, resolveFolderState } from "./folderState.js";
import { hasGrounderMarkerUpward } from "./grounderMarker.js";
import { fetchStatus } from "./status.js";
import {
  buildVaultTree,
  listExtraVaultFolders,
  listVaultDocs,
  listVaultRootFiles,
  type SortKind,
  splitTimestampedLabel,
  type VaultDoc,
  type VaultTreeNode,
} from "./vaultFiles.js";

export type GrounderNode =
  | { kind: "folder"; folder: vscode.WorkspaceFolder }
  | {
      kind: "category";
      label: string;
      icon: string;
      sortKind: SortKind;
      dir: string;
      folder: vscode.WorkspaceFolder;
    }
  | {
      kind: "vaultFolder";
      dir: string;
      folder: vscode.WorkspaceFolder;
      relativePath: string;
      name: string;
      children: VaultTreeNode[];
    }
  | { kind: "doc"; doc: VaultDoc; dir: string; folder: vscode.WorkspaceFolder }
  | {
      kind: "action";
      label: string;
      description?: string;
      commandId: string;
      commandArgs: unknown[];
    }
  | { kind: "message"; label: string; description?: string };

function nodeId(node: GrounderNode): string {
  switch (node.kind) {
    case "folder":
      return `folder:${node.folder.uri.toString()}`;
    case "category":
      return `category:${node.dir}`;
    case "vaultFolder":
      return `vaultFolder:${node.dir}:${node.relativePath}`;
    case "doc":
      return `doc:${node.doc.filePath}`;
    case "action":
      return `action:${node.commandId}:${node.label}`;
    case "message":
      return `message:${node.label}`;
  }
}

/** Converts a level of {@link VaultTreeNode}s (from `buildVaultTree`) into tree items under the given category dir. */
function toGrounderNodes(
  nodes: VaultTreeNode[],
  dir: string,
  folder: vscode.WorkspaceFolder,
): GrounderNode[] {
  return nodes.map((node) =>
    node.kind === "folder"
      ? ({
          kind: "vaultFolder",
          dir,
          folder,
          relativePath: node.relativePath,
          name: node.name,
          children: node.children,
        } as GrounderNode)
      : ({ kind: "doc", doc: node.doc, dir, folder } as GrounderNode),
  );
}

function titleCase(name: string): string {
  return name.length === 0 ? name : name[0]?.toUpperCase() + name.slice(1);
}

/**
 * Tree view backing store: `Notes` / `Handoffs` / `Plans` per linked
 * workspace folder, populated by walking `status --json`'s directory paths
 * directly (not shelling out to `grounder note list` etc. per item).
 *
 * A single-root workspace skips straight to the three category nodes; a
 * multi-root workspace groups by folder first — no separate project picker,
 * per the plan.
 */
export class GrounderTreeDataProvider implements vscode.TreeDataProvider<GrounderNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<GrounderNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly watchers = new Map<string, vscode.FileSystemWatcher>();
  private readonly configListener: vscode.Disposable;
  private dimDates: boolean;
  private showAllVaultItems: boolean;

  /**
   * Category nodes (the three built-ins plus any discovered extra folder)
   * keyed by their dir, populated whenever {@link childrenForFolder} runs.
   * `getParent` reads this to rebuild a doc's/vaultFolder's top-level
   * ancestor for `TreeView.reveal` — the tree must already have rendered at
   * least once for the relevant workspace folder for a reveal to find it.
   */
  private readonly categoryNodes = new Map<string, GrounderNode>();

  constructor() {
    const config = vscode.workspace.getConfiguration("grounder");
    this.dimDates = config.get<boolean>("dimDates", true);
    this.showAllVaultItems = config.get<boolean>("showAllVaultItems", true);
    this.configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("grounder.dimDates") ||
        event.affectsConfiguration("grounder.showAllVaultItems")
      ) {
        const next = vscode.workspace.getConfiguration("grounder");
        this.dimDates = next.get<boolean>("dimDates", true);
        this.showAllVaultItems = next.get<boolean>("showAllVaultItems", true);
        this.refresh();
      }
    });
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.dispose();
    }
    this.watchers.clear();
    this.configListener.dispose();
  }

  /**
   * Reconstructs the parent chain for `TreeView.reveal` — doc/vaultFolder ids
   * (`nodeId`) don't depend on their extra fields, so a synthetic
   * placeholder (e.g. an empty `children`) is enough for VS Code to match it
   * against the real node once it expands that level via `getChildren`.
   */
  getParent(element: GrounderNode): GrounderNode | undefined {
    switch (element.kind) {
      case "doc": {
        const parentRelative = path.dirname(element.doc.relativePath);
        if (parentRelative === ".") {
          const category = this.categoryNodes.get(element.dir);
          if (category) {
            return category;
          }
          // A loose doc directly in the vault root (see `listVaultRootFiles`)
          // has no category node of its own — it sits at the same level as
          // one, so its parent is whatever a category's parent would be.
          const isMultiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
          return isMultiRoot ? { kind: "folder", folder: element.folder } : undefined;
        }
        return {
          kind: "vaultFolder",
          dir: element.dir,
          folder: element.folder,
          relativePath: parentRelative,
          name: path.basename(parentRelative),
          children: [],
        };
      }
      case "vaultFolder": {
        const parentRelative = path.dirname(element.relativePath);
        if (parentRelative === ".") {
          return this.categoryNodes.get(element.dir);
        }
        return {
          kind: "vaultFolder",
          dir: element.dir,
          folder: element.folder,
          relativePath: parentRelative,
          name: path.basename(parentRelative),
          children: [],
        };
      }
      case "category": {
        const isMultiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
        return isMultiRoot ? { kind: "folder", folder: element.folder } : undefined;
      }
      default:
        return undefined;
    }
  }

  getTreeItem(element: GrounderNode): vscode.TreeItem {
    switch (element.kind) {
      case "folder": {
        const item = new vscode.TreeItem(
          element.folder.name,
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.id = nodeId(element);
        item.iconPath = new vscode.ThemeIcon("root-folder");
        item.contextValue = "grounderFolder";
        return item;
      }
      case "category": {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = nodeId(element);
        item.iconPath = new vscode.ThemeIcon(element.icon);
        item.contextValue = "grounderCategory";
        return item;
      }
      case "vaultFolder": {
        const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = nodeId(element);
        item.iconPath = vscode.ThemeIcon.Folder;
        item.contextValue = "grounderVaultFolder";
        return item;
      }
      case "doc": {
        const uri = vscode.Uri.file(element.doc.filePath);
        const { title, date } = this.dimDates
          ? splitTimestampedLabel(element.doc.label)
          : { title: element.doc.label, date: undefined };
        const item = new vscode.TreeItem(title, vscode.TreeItemCollapsibleState.None);
        item.id = nodeId(element);
        item.resourceUri = uri;
        item.description = date;
        item.command = { command: "vscode.open", title: "Open", arguments: [uri] };
        item.contextValue = "grounderDoc";
        return item;
      }
      case "action": {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.id = nodeId(element);
        item.description = element.description;
        item.command = {
          command: element.commandId,
          title: element.label,
          arguments: element.commandArgs,
        };
        item.iconPath = new vscode.ThemeIcon("link-external");
        return item;
      }
      case "message": {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.id = nodeId(element);
        item.description = element.description;
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
      }
    }
  }

  async getChildren(element?: GrounderNode): Promise<GrounderNode[]> {
    if (!element) {
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 0) {
        return [{ kind: "message", label: "Open a folder to use Grounder." }];
      }
      if (folders.length === 1) {
        return this.childrenForFolder(folders[0] as vscode.WorkspaceFolder);
      }
      return folders.map((folder) => ({ kind: "folder", folder }) as GrounderNode);
    }

    if (element.kind === "folder") {
      return this.childrenForFolder(element.folder);
    }

    if (element.kind === "category") {
      const docs = await listVaultDocs(element.dir, element.sortKind);
      if (docs.length === 0) {
        return [{ kind: "message", label: `No ${element.label.toLowerCase()} yet` }];
      }
      return toGrounderNodes(buildVaultTree(docs), element.dir, element.folder);
    }

    if (element.kind === "vaultFolder") {
      return toGrounderNodes(element.children, element.dir, element.folder);
    }

    return [];
  }

  private async childrenForFolder(folder: vscode.WorkspaceFolder): Promise<GrounderNode[]> {
    // Machine-level state (`config.json`, `state.json`, the materialized
    // runtime) lives outside any watched vault dir — without this, running
    // `grounder setup`/`migrate`/`doctor` from the hint terminals never
    // clears a stale error/drift row until the user hits refresh by hand.
    this.watchDir(path.join(grounderHomeDir(), ".grounder"), "**/*");

    const status = await fetchStatus(folder.uri.fsPath);
    const hasMarker =
      status.kind === "no-runtime" ? hasGrounderMarkerUpward(folder.uri.fsPath) : false;
    const state = resolveFolderState(status, hasMarker);

    switch (state.kind) {
      case "no-runtime-unlinked":
        return [
          {
            kind: "action",
            label: "Grounder CLI not installed",
            description: "run `grounder setup`",
            commandId: "grounder.showSetupHint",
            commandArgs: [folder],
          },
        ];

      case "no-runtime-linked":
        return [
          {
            kind: "action",
            label: "Grounder not set up on this machine",
            description: "this project is linked — run `grounder setup`",
            commandId: "grounder.showSetupHint",
            commandArgs: [folder],
          },
        ];

      case "cli-error":
        return [{ kind: "message", label: "Grounder error", description: state.message }];

      case "newer-schema":
        return [
          {
            kind: "message",
            label: "Grounder CLI is newer than this extension expects",
            description: "some info may be unavailable — consider updating the extension",
          },
        ];

      case "machine-config-broken":
        return [
          {
            kind: "action",
            label: "Grounder home config broken",
            description: `${state.configState} — run \`grounder setup <path>\``,
            commandId: "grounder.showSetupHint",
            commandArgs: [folder],
          },
        ];

      case "ledger-missing":
        return [
          {
            kind: "action",
            label: "Grounder install ledger missing",
            description: "run `grounder migrate --force`",
            commandId: "grounder.showMigrateForceHint",
            commandArgs: [folder],
          },
        ];

      case "ledger-broken":
        return state.status === "unsupported"
          ? [
              {
                kind: "message",
                label: "Grounder install ledger broken",
                description: "unsupported — upgrade grounder",
              },
            ]
          : [
              {
                kind: "action",
                label: "Grounder install ledger broken",
                description: "invalid — run `grounder migrate --force`",
                commandId: "grounder.showMigrateForceHint",
                commandArgs: [folder],
              },
            ];

      case "unlinked":
        return [
          {
            kind: "action",
            label: "Link this project",
            commandId: "grounder.linkProject",
            commandArgs: [folder],
          },
        ];

      case "project-schema-unsupported":
        return [
          {
            kind: "message",
            label: "Vault link unsupported",
            description: "upgrade grounder",
          },
        ];

      case "project-config-broken":
        return [
          {
            kind: "action",
            label: "Vault not fully configured",
            description: `${state.configState} — run \`grounder doctor\``,
            commandId: "grounder.showDoctorHint",
            commandArgs: [folder],
          },
        ];

      case "dirs-missing":
        return [
          {
            kind: "action",
            label: "Vault not fully configured",
            description: "run `grounder doctor`",
            commandId: "grounder.showDoctorHint",
            commandArgs: [folder],
          },
        ];

      case "healthy":
        return this.healthyChildren(
          folder,
          state.project,
          state.installDrift,
          state.packageVersionNotice,
        );
    }
  }

  private async healthyChildren(
    folder: vscode.WorkspaceFolder,
    project: LinkedProject,
    installDrift: boolean,
    packageVersionNotice: string | null,
  ): Promise<GrounderNode[]> {
    this.watchDir(project.notesDir);
    this.watchDir(project.logsDir);
    this.watchDir(project.plansDir);

    const categories: Extract<GrounderNode, { kind: "category" }>[] = [
      {
        kind: "category",
        label: "Notes",
        icon: "note",
        sortKind: "generic",
        dir: project.notesDir,
        folder,
      },
      {
        kind: "category",
        label: "Handoffs",
        icon: "history",
        sortKind: "handoffs",
        dir: project.logsDir,
        folder,
      },
      {
        kind: "category",
        label: "Plans",
        icon: "checklist",
        sortKind: "generic",
        dir: project.plansDir,
        folder,
      },
    ];

    if (this.showAllVaultItems && project.vaultRoot) {
      const extraDirs = await listExtraVaultFolders(project.vaultRoot, [
        project.notesDir,
        project.logsDir,
        project.plansDir,
      ]);
      for (const dir of extraDirs) {
        this.watchDir(dir);
        categories.push({
          kind: "category",
          label: titleCase(path.basename(dir)),
          icon: "folder-library",
          sortKind: "generic",
          dir,
          folder,
        });
      }
    }

    for (const category of categories) {
      this.categoryNodes.set(category.dir, category);
    }

    const nodes: GrounderNode[] = [];
    if (installDrift) {
      // Non-blocking notice: the vault itself is fully usable while a
      // migrate is pending, so this sits above the real tree rather than
      // replacing it (unlike every other check in resolveFolderState).
      nodes.push({
        kind: "action",
        label: "Grounder install out of date",
        description: "run `grounder migrate`",
        commandId: "grounder.showMigrateHint",
        commandArgs: [folder],
      });
    }
    if (packageVersionNotice) {
      // Same non-blocking placement as installDrift above. The CLI's fix
      // (`grounder migrate` vs. upgrading the extension's Grounder) depends
      // on which side is ahead — `status --json` only exposes the plain-
      // language message, not the distinction, so this stays a message
      // rather than guessing a remedy command.
      nodes.push({
        kind: "message",
        label: "Grounder version notice",
        description: packageVersionNotice,
      });
    }
    nodes.push(...categories);

    if (this.showAllVaultItems && project.vaultRoot) {
      this.watchDir(project.vaultRoot, "*.md");
      const rootFiles = await listVaultRootFiles(project.vaultRoot);
      for (const doc of rootFiles) {
        nodes.push({ kind: "doc", doc, dir: project.vaultRoot, folder });
      }
    }

    return nodes;
  }

  private watchDir(dir: string, pattern = "**/*.md"): void {
    if (this.watchers.has(dir)) {
      return;
    }
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(dir), pattern),
    );
    watcher.onDidCreate(() => this.refresh());
    watcher.onDidChange(() => this.refresh());
    watcher.onDidDelete(() => this.refresh());
    this.watchers.set(dir, watcher);
  }
}
