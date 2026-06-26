# Grounder

Connect git projects to a personal Obsidian dev vault so AI agents (Cursor, Claude Code, etc.) get persistent memory without committing personal docs to the repo.

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

## Publish

Only `packages/grounder` is published to npm:

```bash
pnpm --filter grounder publish
```

## Plan

See [.ai/plans/grounder-init-cli.md](.ai/plans/grounder-init-cli.md).
