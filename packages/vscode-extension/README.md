# `grounder-vscode-extension`

Not published yet — see the "Grounder VS Code Extension" plan in the vault for full context.
Browses a linked project's Grounder vault (notes/handoffs/plans) in a tree view, and lets you
drag a doc into **Cursor**'s or the **Claude Code** VS Code extension's chat panel to attach it
as context (confirmed working for both — see the plan's Step 1 result). Requires the `grounder`
CLI; this package never imports its internals, only shells out to the materialized runtime at
`~/.grounder/runtime/dist/cli.js`.

**Out of `pnpm check` for now** — own release cadence, own test runner
(`@vscode/test-electron` via `@vscode/test-cli`, `pnpm test:integration`) for anything that
needs the VS Code API, under `test-integration/`. Pure logic (CLI resolution, version-floor
comparison, `status --json` parsing) has normal `vitest` unit tests under `test/`
(`pnpm test:unit`).

On macOS, `pnpm test:integration` may pop a native **"Keychain Not Found"** dialog (Electron's
`safeStorage` trying to create a "Code Key" item) — a known `@vscode/test-electron` quirk with
the downloaded test build, unrelated to this extension. It doesn't block the run either way.
Click **Cancel** — never "Reset to Defaults" (that wipes your real login keychain for an
unrelated disposable test profile).

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

### What stays manual-only

Four of the dogfooding matrix's cases are permanently out of `test-integration/`'s reach, not
temporarily-skipped TODOs:

- **Reveal in Finder/Explorer** (`grounder.revealInOS`) opens the OS's native file manager — not
  worth automating just to assert a `revealFileInOS` command call succeeded.
- **Drag-and-drop into Cursor's, Claude Code's, or GitHub Copilot Chat's chat panel** all need
  that *other* extension's real chat UI. `@vscode/test-electron` launches a bare VS Code (or a
  pinned version) without Cursor and without those chat extensions installed, so this is
  permanently dogfood-only — see the plan's Step 10 for the full cases-to-buckets mapping.

Most of what `@vscode/test-electron` *can* reach — tree structure, settings, open/preview, copy,
live refresh, multi-root grouping, and the search QuickPick flow (via
`test-integration/quickPickHarness.ts`'s callback-capture technique) — has real coverage under
`test-integration/`. Not yet covered, despite being reachable: `grounder.linkProject`; the toggle commands themselves
(only their config side effects are asserted); retrying a search from the zero-hit QuickPick
state; `revealOnOpen: false`; and the tree's rendered content for every non-`"healthy"`
`FolderState` row (the `activation` config's fixture is unlinked, but nothing asserts the tree
actually shows a "Link this project" action for it, let alone the other rows — see
`src/folderState.ts`).

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

### Scripted `FolderState` dogfooding (MCP)

`grounder._debugState` (`src/commands.ts`) is a dev-host-only command — registered only when
`context.extensionMode === vscode.ExtensionMode.Development`, never in the Command Palette or a
packaged install — that returns the resolved `FolderState` per workspace folder, re-running the
same `fetchStatus`/`hasGrounderMarkerUpward` logic the tree view itself uses. It exists so an
external driver can assert the tree's error-state matrix (see `resolveFolderState`,
`src/folderState.ts`) end-to-end without a way to read an extension's TreeView contents directly.

The intended driver is [`acomagu.vscode-as-mcp-server`](https://marketplace.visualstudio.com/items?itemName=acomagu.vscode-as-mcp-server),
installed and active *inside* the dev host window (its single running server targets whichever
VS Code window is currently "active," switched by clicking its own status bar item in that
window — there's no command to script that switch). From an MCP-connected session: mutate
on-disk state, call `execute_vscode_command("grounder._debugState")`, and diff the result against
the expected `FolderState` for that row.

Use the **"Run Extension (fixtures/dev, isolated home)"** launch config for this (`.vscode/launch.json`)
— it sets `GROUNDER_HOME` to a scratch `fixtures/dev-home/` (gitignored), so mutating
config/ledger files for the matrix never touches a real `~/.grounder` install. Seed it once via
the repo's own built CLI:

```bash
pnpm grounder setup fixtures/dev-vault --yes --agent claude   # any scratch vault path works
cd fixtures/dev && node ../../packages/grounder/dist/cli.js link --yes
```

(The plain **"Run Extension (fixtures/dev)"** config is unchanged and still uses your real home,
per `fixture-setup.mjs`'s documented workflow — don't add `GROUNDER_HOME` to it.)

Two rows of the matrix ("never installed/linked anywhere," "not linked, runtime present") need a
workspace folder with no `.grounder.json` anywhere in its ancestry — `fixtures/dev` doesn't
qualify, since it's nested inside this repo, which is itself grounder-linked at its root. There's
no checked-in launch config for this (the folder is necessarily personal/machine-specific): add a
temporary one pointing `--folder-uri` at any such folder on your machine, with the same
`GROUNDER_HOME` env override as the "isolated home" config above, then temporarily rename that
folder's own `.grounder.json` aside to simulate "unlinked."

See `plans/vscode-extension-mcp-dogfood-automation.md` in the vault for the full 15-row matrix and
results from the last scripted pass.
