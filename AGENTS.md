# AGENTS.md — Grounder repo

Grounder is a Node CLI (`packages/grounder`) that wires project folders to personal Obsidian dev vaults for AI agent memory.

## Layout

- `packages/grounder/` — publishable package; all implementation lives here
- `fixtures/minimal-git-repo/` — stable test fixture (automated tests)
- `fixtures/dev/` — local CLI sandbox (`pnpm fixture:setup`)

### `packages/grounder/src/`

```text
connector/          # repo ↔ vault wiring (config stores + resolution)
  home.ts             # ~/.grounder/config.json
  state.ts            # ~/.grounder/state.json install ledger (schemas + file hashes)
  unsupported-schema.ts # forward-compat hard stop (newer on-disk schema)
  repo.ts             # .grounder.json marker, findLinkedRepoRoot
  linked.ts           # resolveLinkedProject (home + marker Result)
  vault.ts            # resolveVaultRoot, resolveNotesDir/LogsDir/PlansDir (config-aware)
  git.ts              # findGitRoot, currentBranch (best-effort)
  project-id.ts       # detectProjectId
vault/                # vault on disk
  layout.ts           # pure path conventions (10-Projects/… notes/ + logs/ + plans/)
  write-note.ts       # note file I/O
  write-handoff.ts    # handoff file I/O (frontmatter + body)
  write-plan.ts       # plan file I/O (named, updatable; --force)
  list-handoffs.ts    # list logs/*.md newest-first
  find-usable-handoff.ts # newest-first, skipping empty/unreadable (peek + list --head)
commands/             # mirrors CLI structure
  require-linked.ts   # CLI stderr wrapper around resolveLinkedProject
  vault/init.ts       # grounder vault init (agent-blind; uses agents registry)
  repo/init.ts        # grounder init (creates notes/ + logs/ + plans/)
  note.ts             # grounder note
  handoff.ts          # grounder handoff
  handoff/list.ts     # grounder handoff list
  plan.ts             # grounder plan
  path/notes.ts       # grounder path notes
  path/logs.ts        # grounder path logs
  path/plans.ts       # grounder path plans
  doctor.ts           # grounder doctor
  migrate.ts          # grounder migrate (refresh install after upgrade)
  apply-agent-installs.ts # shared agent install loop (vault init + migrate)
  upgrade-banner.ts   # stderr notice when package version ahead of ledger
agents/               # AgentAdapter registry (pluggable install targets)
  types.ts            # AgentAdapter interface
  index.ts            # resolveAgents(), detect
  install-command.ts  # shared slash-command install + hash drift detection
  hook-runtime.ts     # ~/.grounder/runtime for session hooks (symlink durable source / copy npx cache)
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
      grounder-plan.md            # named living plan
    claude/commands/
      grounder-note.md
      grounder-task.md
      grounder-task-handoff.md
      grounder-plan.md
  vault/
    session-handoff.md            # lean section reference for slash commands
    plan.md                       # section reference for /grounder-plan
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
