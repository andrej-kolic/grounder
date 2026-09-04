# AGENTS.md — Grounder repo

Grounder is a Node CLI (`packages/grounder`) that links project folders to personal markdown vaults for AI agent memory.

## Layout

- `packages/grounder/` — publishable package; all implementation lives here
- `packages/e2e/` — real-CLI smoke scripts (`pnpm e2e`), not the vitest suite in `packages/grounder/test/`
- `skills/grounder-setup/` — skills.sh meta-skill (CLI driver; not in the npm tarball)
- `fixtures/minimal-git-repo/` — stable test fixture (automated tests)
- `fixtures/dev/` — local CLI sandbox (`pnpm fixture:setup`)
- `docs/` — user docs (CLI reference, configuration, upgrading, hooks, troubleshooting) + `docs/architecture/` design notes
- `CONTRIBUTING.md` — build/test/release workflow (moved out of the root README)

Docs rule: the root `README.md` is the front door and is canonical. Anything past the
first successful run — full flag tables, configuration, upgrade mechanics, troubleshooting
— belongs in `docs/`. `packages/grounder/README.md` is the npm-facing subset and must use
absolute URLs for images and links, since relative paths break outside the tarball.

### `packages/grounder/src/`

```text
connector/          # repo ↔ vault wiring (config stores + resolution)
  home.ts             # ~/.grounder/config.json
  state.ts            # ~/.grounder/state.json install ledger (schemas + file hashes)
  ledger-migrations.ts # ledgerSchema upgrade table + walker (state.json shape only)
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
  list-markdown.ts    # recursive *.md walk (shared by list + search)
  list-handoffs.ts    # list logs/**/*.md newest basename first
  list-plans.ts       # list plans/**/*.md newest mtime first
  list-notes.ts       # list notes/**/*.md newest mtime first
  find-usable-handoff.ts # newest-first, skipping empty/unreadable (peek + list --head)
  search.ts           # vault markdown scan + rank (grounder search)
commands/             # mirrors CLI structure
  require-linked.ts   # CLI stderr wrapper around resolveLinkedProject
  search.ts           # grounder search (linked project vault root)
  setup.ts            # grounder setup (agent-blind; uses agents registry)
  link.ts             # grounder link (creates notes/ + logs/ + plans/)
  note.ts             # grounder note
  note/list.ts        # grounder note list
  handoff.ts          # grounder handoff
  handoff/list.ts     # grounder handoff list
  handoff/peek.ts      # grounder handoff peek (session-start hook teaser)
  plan.ts             # grounder plan
  plan/list.ts        # grounder plan list
  path/notes.ts       # grounder path notes
  path/logs.ts        # grounder path logs
  path/plans.ts       # grounder path plans
  check.ts            # shared ok/warn/fail CheckResult type (doctor)
  doctor.ts           # grounder doctor
  status.ts           # grounder status
  install-drift.ts    # cheap ledger-only "would migrate change something" (status/peek)
  output.ts           # shared formatting (doctor/status + vault item lists)
  migrate.ts          # grounder migrate (refresh install after upgrade)
  apply.ts            # shared agent install loop (setup + migrate)
  render-artifact-table.ts # shared STATUS/TARGET/PATH table + summary (setup + migrate)
  package-version-notice.ts # package-vs-ledger version comparison (doctor/status)
  upgrade-banner.ts   # stderr notice when package version ahead of ledger
reconcile/            # pure desired/ledger/disk plan core + its I/O edges
  core.ts             # reconcile(), desiredDrift(), planChangesLedger() — no I/O
  disk.ts             # readDiskHashes() — the only disk-read edge
  apply.ts            # applyPlan() — the only disk-write edge
agents/               # AgentAdapter registry (pluggable install targets)
  types.ts            # AgentAdapter interface
  index.ts            # resolveAgents(), ownedLedgerFiles(), detect
  hook-fragment.ts    # shared always-converge JSON fragment helpers (cursor/claude hooks)
  hook-runtime.ts     # ~/.grounder/runtime for session hooks (symlink durable source / copy npx cache)
  cursor-hook-input.ts # Cursor sessionStart hook stdin parsing
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
    cursor/skills/
      grounder-note/SKILL.md
      grounder-task/SKILL.md            # recall — read-only hydrate
      grounder-task-handoff/SKILL.md    # write session checkpoint
      grounder-plan/SKILL.md            # named living plan
      grounder-search/SKILL.md          # vault retrieval — CLI ranks, agent synthesizes
    claude/skills/
      grounder-note/SKILL.md
      grounder-task/SKILL.md
      grounder-task-handoff/SKILL.md
      grounder-plan/SKILL.md
      grounder-search/SKILL.md
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
pnpm e2e              # real-CLI smoke scripts (packages/e2e/), not part of `check`
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
- Lead with the plain statement — in comments/docblocks *and* in chat replies to the user.
  Sentence one says what the thing is, does, or is about; caveats, exceptions, and
  cross-references come after, never before and never tangled into it. If sentence one is a
  "not X because Y" clause, the reader has to decrypt the whole paragraph before learning the
  subject — rewrite it so the plain statement leads.
