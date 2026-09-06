# `grounder-vscode-extension`

Not published yet — see the "Grounder VS Code Extension" plan in the vault for full context.
Browses a linked project's Grounder vault (notes/handoffs/plans) in a tree view, and lets you
drag a doc into **Cursor**'s or the **Claude Code** VS Code extension's chat panel to attach it
as context (confirmed working for both — see the plan's Step 1 result). Requires the `grounder`
CLI; this package never imports its internals, only shells out to the materialized runtime at
`~/.grounder/runtime/dist/cli.js`.

**Out of `pnpm check` for now** — own release cadence, own test runner
(`@vscode/test-electron`, not wired up yet) for anything that needs the VS Code API. Pure logic
(CLI resolution, version-floor comparison, `status --json` parsing) has normal `vitest` unit
tests under `test/`.

## What's here

- Tree view ("Grounder" in the Explorer sidebar): `Notes` / `Handoffs` / `Plans` per linked
  workspace folder (grouped by folder in a multi-root workspace, flat in a single-root one).
  Populated by walking `status --json`'s directory paths directly, not by shelling out per item.
  Live-refreshes via a file watcher on each directory.
- "Link this project" action when the open folder isn't linked yet; a setup hint (opens a
  terminal with `grounder setup`) when the CLI itself isn't installed, or when it's installed but
  this machine hasn't run `setup` for this project yet. Every other state `grounder status --json`
  can report (broken home config, a missing/corrupt/unsupported install ledger, a pending
  `grounder migrate`, an unsupported vault link schema) gets its own tree item and remedy too —
  see `resolveFolderState` (`src/folderState.ts`) for the full ordered check list.
- Click a doc to open it in the editor; drag it into a chat panel to attach it; right-click →
  "Copy as @mention" for chat surfaces that need typed text instead (Claude Code's own chat
  currently needs Shift-drag and only ever inserts `@mention` text anyway — see the plan's
  Decisions).
- Command palette: "Grounder: Search Vault" (backed by `grounder search --json`), results in a
  QuickPick; accept to open, or use the item's clipboard button to copy it as an `@mention`.

## Multi-root workspaces

In a multi-root workspace, an AI agent's `grounder` commands target whichever folder is its
current working directory — normally the first workspace folder, but it can change mid-session.
The tree view has no way to detect or show this.

## Build

```bash
pnpm --filter grounder-vscode-extension build   # from repo root
pnpm --filter grounder-vscode-extension test:unit
```

## Manual testing

Open this directory (`packages/vscode-extension/`) itself as the workspace folder — not the
monorepo root — so `.vscode/launch.json` here applies.

### If developing inside Cursor itself

Press `F5` ("Run Extension"). This launches a **Cursor** Extension Development Host directly —
open a linked project there and drag/drop-test against Cursor's real chat panel.

### If developing in plain VS Code

`F5` launches a **VS Code** Extension Development Host, which can't reach Cursor's real chat
panel. Instead, package and sideload into real Cursor:

```bash
pnpm --filter grounder-vscode-extension build
pnpm --filter grounder-vscode-extension package   # runs `npx @vscode/vsce package`, produces a .vsix
```

Then in Cursor: Extensions view → `...` menu → "Install from VSIX..." → pick the generated
`.vsix`. Reload, open a linked project, and drag-test against the real chat panel.

(`@vscode/vsce` is invoked via `npx`, not a workspace devDependency — its optional native deps
`keytar`/`@vscode/vsce-sign` trip pnpm's build-script approval gate and break `pnpm run` for the
whole monorepo, not just this package.)

### Testing against the Claude Code VS Code extension's chat panel

Same caveat as Cursor: a plain VS Code Extension Development Host won't have it installed by
default. Make sure the Claude Code extension is present and enabled in whichever dev host you
use before drag-testing.
