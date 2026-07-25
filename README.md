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

Only `packages/grounder` is published to npm. Releases are tag-driven via GitHub Actions (OIDC trusted publishing) — do not publish from a laptop for steady-state releases.

1. Ensure `main` is green.
2. Bump `version` in `packages/grounder/package.json` and merge to `main`.
3. Tag and push (tag must match the package version, e.g. `0.1.0` → `v0.1.0`):

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

4. Watch the [Release](https://github.com/andrej-kolic/grounder/actions/workflows/release.yml) workflow — it runs `pnpm check`, publishes to npm, and creates a GitHub Release.

## Architecture

Agent-agnostic core (`connector/`, `vault/`, `commands/`) plus a pluggable `agents/` adapter registry for Cursor, Claude Code, and future targets. Templates: `packages/grounder/templates/agents/{id}/`.

## Plan

Phase 1: [.ai/plans/grounder-phase-1-minimal-connector.md](.ai/plans/grounder-phase-1-minimal-connector.md)  
Agent adapters (implemented): [.ai/discussions/pluggable.md](.ai/discussions/pluggable.md)  
Phase 2 handoff: [.ai/plans/grounder-phase-2-handoff.md](.ai/plans/grounder-phase-2-handoff.md)  
Full roadmap: [.ai/plans/grounder-init-cli.md](.ai/plans/grounder-init-cli.md)
