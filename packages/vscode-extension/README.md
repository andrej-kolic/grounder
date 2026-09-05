# `grounder-vscode-extension` (drag-and-drop spike)

Not a real release — this tests one assumption before anything else gets built: can a VS Code
`TreeDataProvider` drag a file into **Cursor's** chat panel or the **Claude Code** VS Code
extension's chat panel? See the "Grounder VS Code Extension" plan (Step 1) in the vault for the
full context.

It contributes one tree view, "Grounder (spike)", in the Explorer sidebar, with a single
hardcoded item pointing at this package's own `README.md` (this file) — a real file to drag, no
CLI invocation, no real vault reading yet.

**Out of `pnpm check` for now** — own release cadence, no test runner wired up yet (same
rationale as `packages/e2e`).

## Build

```bash
pnpm --filter grounder-vscode-extension build   # from repo root
```

## Manual testing

Open this directory (`packages/vscode-extension/`) itself as the workspace folder — not the
monorepo root — so `.vscode/launch.json` here applies.

### If developing inside Cursor itself

Press `F5` ("Run Extension"). This launches a **Cursor** Extension Development Host directly —
drag the "README.md" tree item from the "Grounder (spike)" view into Cursor's chat panel there.

### If developing in plain VS Code

`F5` launches a **VS Code** Extension Development Host, which can't reach Cursor's real chat
panel. Instead, package and sideload into real Cursor:

```bash
pnpm --filter grounder-vscode-extension build
pnpm --filter grounder-vscode-extension package   # runs `npx @vscode/vsce package`, produces a .vsix
```

Then in Cursor: Extensions view → `...` menu → "Install from VSIX..." → pick the generated
`.vsix`. Reload, open the "Grounder (spike)" view, and drag-test against the real chat panel.

(`@vscode/vsce` is invoked via `npx`, not a workspace devDependency — its optional native deps
`keytar`/`@vscode/vsce-sign` trip pnpm's build-script approval gate and break `pnpm run` for the
whole monorepo, not just this package.)

### Testing against the Claude Code VS Code extension's chat panel

Same caveat as Cursor: a plain VS Code Extension Development Host won't have it installed by
default. Make sure the Claude Code extension is present and enabled in whichever dev host you
use (install it into that dev host, or sideload this extension's `.vsix` into a real VS Code /
Cursor install where Claude Code is already enabled) before drag-testing.

## Outcome

If the drop lands in either chat panel, the tree view + drag-and-drop plan proceeds as scoped.
If not, "copy path as `@mention`" becomes the real v1 mechanism instead of a fallback.
