# Changelog

All notable changes to the Grounder VS Code extension are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Tree view ("Grounder" in the Explorer sidebar) showing a linked project's Notes,
  Handoffs, and Plans — grouped by folder in a multi-root workspace, live-refreshed via
  file watchers.
- Drag a doc into Cursor's or the Claude Code extension's chat panel to attach it as
  context; "Copy as @mention" for chat surfaces that need typed text instead.
- "Grounder: Search Vault" command, results in a QuickPick.
- In-tree guidance and remedy for every state `grounder status` can report — unlinked,
  broken config, missing/corrupt install, pending `grounder migrate`, unsupported schema.
