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
  linked.ts           # resolveLinkedProject (home + marker Result)
  vault.ts            # resolveVaultRoot, resolveNotesDir/LogsDir (config-aware)
  git.ts              # findGitRoot, currentBranch (best-effort)
  project-id.ts       # detectProjectId
vault/                # vault on disk
  layout.ts           # pure path conventions (10-Projects/… notes/ + logs/)
  write-note.ts       # note file I/O
  write-handoff.ts    # handoff file I/O (frontmatter + body)
  list-handoffs.ts    # list logs/*.md newest-first
commands/             # mirrors CLI structure
  require-linked.ts   # CLI stderr wrapper around resolveLinkedProject
  vault/init.ts       # grounder vault init (agent-blind; uses agents registry)
  repo/init.ts        # grounder init (creates notes/ + logs/)
  note.ts             # grounder note
  handoff.ts          # grounder handoff
  handoff/list.ts     # grounder handoff list
  path/notes.ts       # grounder path notes
  path/logs.ts        # grounder path logs
agents/               # AgentAdapter registry (pluggable install targets)
  types.ts            # AgentAdapter interface
  index.ts            # resolveAgents(), detect
  cursor.ts           # Cursor adapter
  claude.ts           # Claude Code adapter
util/                 # shared helpers (fs, parse-args, prompt, slugs, path)
```

Naming rule: `resolve*` = config/env aware; plain names in `vault/layout.ts` = pure path segments.

Agent-agnostic core = `connector/`, `vault/`, most of `commands/`, `util/`. Agent-specific glue lives only under `agents/` (+ matching templates).

### Templates

```text
packages/grounder/templates/
  agents/
    cursor/commands/
      grounder-note.md
      grounder-task.md            # recall — read-only hydrate
      grounder-task-handoff.md    # write session checkpoint
    claude/commands/
      grounder-note.md
      grounder-task.md
      grounder-task-handoff.md
  vault/
    session-handoff.md            # lean section reference for slash commands
  bridge/                         # deferred (Phase 2+)
```

## Commands

```bash
pnpm install          # from repo root
pnpm build            # compile packages/grounder
pnpm typecheck        # tsc --noEmit
pnpm lint             # biome check (format + lint)
pnpm format           # biome format --write
pnpm test             # unit + CLI smoke tests
pnpm check            # build + typecheck + lint + test (CI / local one-shot)
pnpm grounder --version
pnpm fixture:setup    # print dev fixture next steps
```

Root scripts are the quality contract — CI and agents should call these entrypoints, not ad-hoc tool invocations. Keep dependencies minimal.

## Quality loop

1. Implement in `packages/grounder/src/`
2. Add or update tests in `packages/grounder/test/` (mirror `src/` layout)
3. Use `fixtures/minimal-git-repo/` for integration tests that need a git project
4. Run `pnpm check` before finishing

## Conventions

- Node 18+, ESM (`"type": "module"`)
- TypeScript in `src/`, output to `dist/`
- Templates ship in `packages/grounder/templates/` (included in npm `files`)
- Idempotent file generation — never clobber user-edited vault content without `--force`
- New agents: add `src/agents/<id>.ts` + `templates/agents/<id>/`, register in `agents/index.ts`

## Plan

Phase 1 complete: `.ai/plans/grounder-phase-1-minimal-connector.md`  
Agent adapters (Option B): `.ai/discussions/pluggable.md` — **implemented**  
Phase 2 handoff: `.ai/plans/grounder-phase-2-handoff.md`  
Phase 2+ reference: `.ai/plans/grounder-init-cli.md`
