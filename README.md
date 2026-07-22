# Grounder

Monorepo for the [Grounder](https://www.npmjs.com/package/grounder) CLI — connect project folders to a personal Obsidian vault so AI agents get persistent memory without committing personal docs to the repo.

**Install and use:** see [packages/grounder/README.md](packages/grounder/README.md).

## Monorepo layout

```text
grounder/
├── packages/grounder/     # publishable npm package (`grounder`)
├── fixtures/              # test git repos (not published)
└── .ai/plans/             # implementation plans
```

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm grounder --version    # run local CLI (build first)
```

### Try the CLI locally

Use `fixtures/dev/` as a workspace sandbox (not the test fixture):

```bash
pnpm fixture:setup
pnpm grounder vault init ~/Documents/obsidian/dev --yes   # once per machine
cd fixtures/dev
pnpm grounder init --yes
pnpm grounder note "hello from dev fixture"
pnpm grounder handoff "# Handoff"$'\n\n'"## Next"$'\n'"1. Try /grounder-task next session"
pnpm grounder handoff list
pnpm grounder path logs
```

Session loop in the agent: `/grounder-task` → work → `/grounder-task-handoff`.

See [fixtures/dev/README.md](fixtures/dev/README.md).

## Publish

Only `packages/grounder` is published to npm:

```bash
pnpm --filter grounder publish
```

## Architecture

Agent-agnostic core (`connector/`, `vault/`, `commands/`) plus a pluggable `agents/` adapter registry for Cursor, Claude Code, and future targets. Templates: `packages/grounder/templates/agents/{id}/`.

## Plan

Phase 1: [.ai/plans/grounder-phase-1-minimal-connector.md](.ai/plans/grounder-phase-1-minimal-connector.md)  
Agent adapters (implemented): [.ai/plans/pluggable.md](.ai/plans/pluggable.md)  
Phase 2 handoff: [.ai/plans/grounder-phase-2-handoff.md](.ai/plans/grounder-phase-2-handoff.md)  
Full roadmap: [.ai/plans/grounder-init-cli.md](.ai/plans/grounder-init-cli.md)
