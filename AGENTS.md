# AGENTS.md — Grounder repo

Grounder is a Node CLI (`packages/grounder`) that wires git projects to personal Obsidian dev vaults for AI agent memory.

## Layout

- `packages/grounder/` — publishable package; all implementation lives here
- `fixtures/` — fake consumer repos for integration tests (not npm packages)
- `.ai/plans/` — product and implementation plans

## Commands

```bash
pnpm install          # from repo root
pnpm build            # compile packages/grounder
pnpm test             # unit + CLI smoke tests
pnpm grounder --version
```

Run tests after every change. Keep dependencies minimal.

## Quality loop

1. Implement in `packages/grounder/src/`
2. Add or update tests in `packages/grounder/test/`
3. Use `fixtures/minimal-git-repo/` for integration tests that need a git project
4. Run `pnpm test` before finishing

## Conventions

- Node 18+, ESM (`"type": "module"`)
- TypeScript in `src/`, output to `dist/`
- Templates ship in `packages/grounder/templates/` (included in npm `files`)
- Idempotent file generation — never clobber user-edited vault content without `--force`

## Plan

Follow `.ai/plans/grounder-init-cli.md` phase-by-phase.
