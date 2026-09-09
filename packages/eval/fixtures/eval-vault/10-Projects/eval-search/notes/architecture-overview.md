---
topics: ["architecture", "design", "components"]
---

# System architecture overview

The system splits into three layers: the connector layer resolves which
vault and project a repo is linked to, the vault layer reads and writes
markdown content on disk, and the command layer wires CLI flags to both.

## Components

- **Connector** — config stores and resolution (home config, install
  ledger, repo marker, vault root resolution).
- **Vault** — pure path layout plus note/handoff/plan file I/O and the
  markdown search index.
- **Commands** — one module per CLI subcommand, agent-blind.

## Design notes

Each component is designed to be testable in isolation: the connector layer
takes an explicit home directory, the vault layer takes an explicit root
directory, and commands compose both through dependency injection rather
than reading global state directly.
