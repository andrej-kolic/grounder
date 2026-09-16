# Changelog

All notable changes to the Grounder VS Code extension are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.3] - 2026-09-16

### Changed

- Migrated publisher from `grounder` to `andrej-kolic` on the VS Code Marketplace and
  Open VSX — the old `grounder.grounder-vscode-extension` listing is being retired in
  favor of this personal, brand-neutral identity (see #119).

## [0.1.2] - 2026-09-16

### Changed

- Re-cropped the extension icon so the mark fills more of the frame.

## [0.1.1] - 2026-09-16

### Changed

- Updated the Marketplace description.

## [0.1.0] - 2026-09-15

### Added

- Tree view ("Grounder" in the Explorer sidebar) showing a linked project's Notes,
  Handoffs, and Plans — grouped by folder in a multi-root workspace, live-refreshed via
  file watchers.
- Drag a doc into Cursor's or the Claude Code extension's chat panel to attach it as
  context; "Copy as @mention" for chat surfaces that need typed text instead.
- "Grounder: Search Vault" command, results in a QuickPick.
- In-tree guidance and remedy for every state `grounder status` can report — unlinked,
  broken config, missing/corrupt install, pending `grounder migrate`, unsupported schema.
