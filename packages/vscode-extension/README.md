# Grounder Xplorer

**[Grounder](https://github.com/andrej-kolic/grounder)** keeps AI coding agent memory — notes,
handoffs, plans — in plain markdown files instead of chat history, so work picked up in
Cursor or Claude Code survives across sessions and machines.

This extension browses that vault in the sidebar, and lets you drag any doc into **Cursor**'s
or the **Claude Code** extension's chat panel to attach it as context.

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=andrej-kolic.grounder-vscode)
or [Open VSX](https://open-vsx.org/extension/andrej-kolic/grounder-vscode), or search
"Grounder" in your editor's Extensions view.

![Dragging a plan from the Grounder tree into Cursor's chat panel](https://raw.githubusercontent.com/andrej-kolic/grounder/main/docs/assets/vscode-extension-drag-to-chat.gif)

## Requirements

- The `grounder` CLI, `0.6.0`+, installed and linked for the
  open project (`grounder setup` + `grounder link` — see the [main
  README](https://github.com/andrej-kolic/grounder)). The extension shells out to it; it never
  imports the CLI's internals.

## What you get

- **Tree view** ("Grounder" in the Explorer sidebar): `Notes` / `Handoffs` / `Plans` per linked
  workspace folder, live-refreshing as files change on disk.
- **Drag to chat**: drag a doc into Cursor's or Claude Code's chat panel to attach it as
  context. Right-click → "Copy as @mention" for chat surfaces that need typed text instead.
- **Search Vault** command: rank vault content by query, right from the Command Palette.
- In-tree guidance whenever something's not set up yet — the CLI isn't installed, the project
  isn't linked, or an install needs `grounder migrate` — each with its own action to fix it.

## Multi-root workspaces

In a multi-root workspace, an AI agent's `grounder` commands target whichever folder is its
current working directory — normally the first workspace folder, but it can change mid-session.
The tree view has no way to detect or show this.

## Links

- [Grounder on GitHub](https://github.com/andrej-kolic/grounder) — CLI, docs, and the vault model
- [CONTRIBUTING.md](https://github.com/andrej-kolic/grounder/blob/main/packages/vscode-extension/CONTRIBUTING.md) —
  build, test, and manual dogfooding for this extension
