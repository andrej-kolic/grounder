# AGENTS.md — Grounder repo

Grounder is a Node CLI (`packages/grounder`) that wires project folders to personal Obsidian dev vaults for AI agent memory.

## Layout

- `packages/grounder/` — publishable package; all implementation lives here
- `fixtures/minimal-git-repo/` — stable test fixture (automated tests)
- `fixtures/dev/` — local CLI sandbox (`pnpm fixture:setup`)
- `.ai/plans/` — product and implementation plans

### `packages/grounder/src/`

```text
connector/          # repo ↔ vault wiring (config stores + resolution)
  home.ts             # ~/.grounder/config.json
  repo.ts             # .grounder.json marker, findLinkedRepoRoot
  vault.ts            # resolveVaultRoot, resolveNotesDir (config-aware)
  git.ts              # findGitRoot
  project-id.ts       # detectProjectId
vault/                # vault on disk
  layout.ts           # pure path conventions (10-Projects/…)
  write-note.ts       # note file I/O
commands/             # mirrors CLI structure
  vault/init.ts       # grounder vault init
  repo/init.ts        # grounder init
  note.ts             # grounder note
  path/notes.ts       # grounder path notes
cursor/
  grounder-note.ts    # install /grounder-note slash command
util/                 # shared helpers (fs, parse-args, prompt, slugs)
```

Naming rule: `resolve*` = config/env aware; plain names in `vault/layout.ts` = pure path segments.

## Commands

```bash
pnpm install          # from repo root
pnpm build            # compile packages/grounder
pnpm test             # unit + CLI smoke tests
pnpm grounder --version
pnpm fixture:setup    # print dev fixture next steps
```

Run tests after every change. Keep dependencies minimal.

## Quality loop

1. Implement in `packages/grounder/src/`
2. Add or update tests in `packages/grounder/test/` (mirror `src/` layout)
3. Use `fixtures/minimal-git-repo/` for integration tests that need a git project
4. Run `pnpm test` before finishing

## Conventions

- Node 18+, ESM (`"type": "module"`)
- TypeScript in `src/`, output to `dist/`
- Templates ship in `packages/grounder/templates/` (included in npm `files`)
- Idempotent file generation — never clobber user-edited vault content without `--force`

## Plan

Phase 1 complete: `.ai/plans/grounder-phase-1-minimal-connector.md`  
Phase 2+ reference: `.ai/plans/grounder-init-cli.md`
