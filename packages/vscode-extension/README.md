# Grounder for VS Code

Browse your [Grounder](https://github.com/andrej-kolic/grounder) vault — notes, handoffs,
plans — in the sidebar, and drag any doc into **Cursor**'s or the **Claude Code** extension's
chat panel to attach it as context.

Not published to the Marketplace yet — see [CONTRIBUTING.md](CONTRIBUTING.md) to build and
sideload it, or the main repo's plan for status.

<!-- TODO(#110): screenshot/gif of the tree view + drag-to-chat, once the extension is far
     enough along to be worth capturing for the Marketplace listing. -->

## Requirements

- The `grounder` CLI, installed and linked for the open project (`grounder setup` +
  `grounder link` — see the [main README](https://github.com/andrej-kolic/grounder)). The
  extension shells out to it; it never imports the CLI's internals.
- `grounder` CLI <!-- placeholder pending #113 --> `0.6.0`+.

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
- [CONTRIBUTING.md](CONTRIBUTING.md) — build, test, and manual dogfooding for this extension
