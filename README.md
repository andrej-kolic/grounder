# Grounder

Connect git projects to a personal Obsidian vault so AI agents (Cursor, Claude Code, etc.) get persistent memory without committing personal docs to the repo.

## Quickstart

```bash
# Once per machine — set vault location + install /grounder-note in Cursor
grounder vault init ~/Documents/obsidian/dev

# Once per repo — link project id to vault notes folder
cd your-git-project
grounder init

# Write a note (or use /grounder-note in Cursor)
grounder note "Investigate auth middleware"
```

Notes land in `<vault>/10-Projects/{projectId}/notes/`. Machine-specific vault paths live in `~/.grounder/config.json`; each repo stores only `.grounder.json` with `{ "version": 1, "projectId": "..." }`.

Override vault root for a session: `GROUNDER_VAULT=/path/to/vault`.

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

Use `fixtures/dev/` as a nested git repo sandbox (not the test fixture):

```bash
pnpm fixture:setup
pnpm grounder vault init ~/Documents/obsidian/dev --yes   # once per machine
cd fixtures/dev
pnpm grounder init --yes
pnpm grounder note "hello from dev fixture"
```

See [fixtures/dev/README.md](fixtures/dev/README.md).

## Publish

Only `packages/grounder` is published to npm:

```bash
pnpm --filter grounder publish
```

## Plan

Phase 1: [.ai/plans/grounder-phase-1-minimal-connector.md](.ai/plans/grounder-phase-1-minimal-connector.md)  
Full roadmap: [.ai/plans/grounder-init-cli.md](.ai/plans/grounder-init-cli.md)
