# Plan: Grounder — `npx grounder init` for Obsidian + AI agent connection

**Status:** Draft — ready for implementation  
**Repo:** `/Users/andrejkolic/dev/rey/grounder`  
**Created:** 2026-06-25  
**Updated:** 2026-06-26 (decisions 13–20; slash UX; MCP I/O; **`grounder-` command prefix**)  
**Reference:** Manual prototype validated 2026-06-25 (turborepo + grounder registered; prototype used legacy `x-` prefix — Grounder ships `grounder-`)

## How to run (new chat)

Attach or `@`-mention this file.

**Minimal prompt:**

```text
Implement the Grounder plan in .ai/plans/grounder-init-cli.md. Execute phase-by-phase.
```

**Full agent instructions:**

```text
Implement this plan in /Users/andrejkolic/dev/rey/grounder.

- Node CLI, publishable npm package `grounder`, bin `grounder`.
- Primary UX: `npx grounder init` run from any git project root.
- Codify the manual Obsidian+Cursor workflow from this plan's reference section — do not invent a different vault layout.
- Idempotent: re-run init must not clobber user-edited bridge notes or logs.
- No secrets in generated files. Repo marker only — vault stays personal.
- Add tests for file generation and JSON merge logic.
- After each phase: run tests; keep package minimal (no heavy deps).
```

---

## Executive summary

**Grounder** connects a git project to a personal Obsidian dev vault so AI agents (Cursor, Claude Code, etc.) get persistent memory — bridge notes, logs, templates, registry — without committing personal docs to the repo.

**Primary command:**

```bash
cd /path/to/my-project
npx grounder init
```

**One-time user setup** (first machine / first vault):

```bash
npx grounder vault init ~/Documents/obsidian/dev
```

After both: open project in Cursor, type `/` → pick `/grounder-task` to start, `/grounder-task-handoff` to end.

---

## Problem

Connecting a repo to Obsidian for AI agents currently requires many manual steps:

1. Vault folder layout (`00-AI/`, `10-Projects/`, `templates/`, …)
2. `projects.json` registry
3. Per-project bridge note + `logs/`, `notes/`, `plans/`, `decisions/`
4. User-level Cursor MCP (`@bitbonsai/mcpvault`)
5. Six Cursor slash commands (`/grounder-task`, …)
6. User rule (command → folder router)
7. User skill (procedure: MCP, templates, paths)
8. Optional shell helper for daily logs

This is error-prone. Grounder automates it.

---

## Reference implementation (manual prototype)

Already working on this machine — **treat as spec, not suggestion**:

| Artifact | Path |
| --- | --- |
| Vault root | `~/Documents/obsidian/dev` |
| Registry | `00-AI/projects.json` |
| Agent workflow | `00-AI/agent-workflow.md` |
| Governance | `00-AI/governance/write-rules.md` |
| Templates | `templates/{daily-log,session-handoff,plan,decision}.md` |
| Project bridge | `10-Projects/<id>/_project.md` |
| User MCP | `~/.cursor/mcp.json` → `obsidian-dev` |
| Slash commands | `~/.cursor/commands/grounder-{task,task-continue,task-handoff,note,plan,decision}.md` |
| User rule | `~/.cursor/rules/grounder-vault.mdc` (router) |
| User skill | `~/.cursor/skills/grounder-vault/SKILL.md` (procedure) |
| Daily log script | `00-AI/bin/new-daily-log.sh` |

### Cursor UX (three layers)

| Layer | Role |
| --- | --- |
| **Commands** | User picks `/grounder-*` from `/` menu → triggers action |
| **Rule** | Maps each command to exactly one vault folder |
| **Skill** | Shared how-to: resolve project, MCP tools, templates |

| Command | Writes to |
| --- | --- |
| `/grounder-task` | read only (bridge, log, AGENTS.md) |
| `/grounder-task-continue` | read only (prioritize handoff) |
| `/grounder-task-handoff` | `logs/YYYY-MM-DD.md` |
| `/grounder-note` | `notes/` — Mode A: `/grounder-note text` verbatim; Mode B: `task /grounder-note` agent output |
| `/grounder-plan` | `plans/` |
| `/grounder-decision` | `decisions/` |

Registered projects: `turborepo-react-starter`, `grounder`.

### Cursor naming

| Artifact | Pattern | Example |
| --- | --- | --- |
| Slash commands | `grounder-<action>.md` → `/grounder-<action>` | `/grounder-note`, `/grounder-task` |
| Rule | `grounder-vault.mdc` | Router table for all `/grounder-*` commands |
| Skill | `grounder-vault/SKILL.md` | Shared procedure (resolve project, MCP, templates) |

MCP server name stays **`obsidian-dev`** (transport layer; unchanged).

Legacy manual prototype used `x-` prefix — Grounder ships `grounder-`.

---

## Design principles

1. **Repo holds a pointer, vault holds memory** — commit `.grounder.json` (small); never commit vault content into the repo.
2. **Repo docs win** — `AGENTS.md` / `docs/` override vault for commands; vault is logs, notes, plans, decisions.
3. **Idempotent init** — safe to re-run; merge registry; skip existing notes unless `--force`.
4. **Local-first** — no cloud, no API keys; MCP reads markdown on disk.
5. **Agent-agnostic vault** — layout works with file access; Cursor uses MCP first, filesystem fallback.

---

## Commands (v1)

| Command | Where | Purpose |
| --- | --- | --- |
| `grounder vault init [path]` | anywhere | One-time: vault scaffold + MCP + commands + rule + skill |
| `grounder init` | **project root** | Register project in vault; write bridge + folders + repo marker |
| `grounder status` | project root | Show link state (vault path, bridge exists, registry entry) |
| `grounder doctor` | project root or `--global` | Check MCP, vault paths, registry consistency |

Future (out of v1): `grounder log`, `grounder handoff` (CLI wrappers for templates).

---

## What `grounder vault init` creates (once per vault)

```
<VAULT>/
├── 00-AI/
│   ├── START-HERE.md
│   ├── projects.json          # { vaultRoot, templatesDir, projects: {} }
│   ├── agent-workflow.md
│   ├── governance/write-rules.md
│   └── bin/new-daily-log.sh
├── templates/
│   ├── daily-log.md
│   ├── session-handoff.md
│   ├── plan.md
│   └── decision.md
└── 90-Inbox/README.md
```

**User-level (merge, not overwrite):**

- `~/.cursor/mcp.json` — add `obsidian-dev` server (detect `npx` via `which npx`)
- `~/.cursor/commands/grounder-*.md` — six slash commands (skip existing unless `--force`)
- `~/.cursor/rules/grounder-vault.mdc` — router table (skip unless `--force`)
- `~/.cursor/skills/grounder-vault/SKILL.md` — procedure doc (skip unless `--force`)

**Config persistence:** `~/.grounder/config.json`

```json
{
  "vaultRoot": "/Users/you/Documents/obsidian/dev",
  "mcpServerName": "obsidian-dev",
  "mcpPackage": "@bitbonsai/mcpvault@0.11.0",
  "cursorRuleName": "grounder-vault",
  "cursorSkillName": "grounder-vault",
  "cursorCommands": ["grounder-task", "grounder-task-continue", "grounder-task-handoff", "grounder-note", "grounder-plan", "grounder-decision"]
}
```

---

## What `grounder init` creates (per project)

### In vault

```
10-Projects/<project-id>/
├── _project.md              # bridge (from template + detected repo metadata)
├── logs/                    # empty; optional starter log for today
├── notes/
├── plans/
└── decisions/
```

**Updates:** merge entry into `00-AI/projects.json`:

```json
"<project-id>": {
  "bridge": "10-Projects/<project-id>/_project.md",
  "repo": "<absolute-repo-path>",
  "agentsMd": "AGENTS.md",
  "logsDir": "10-Projects/<project-id>/logs",
  "notesDir": "10-Projects/<project-id>/notes",
  "plansDir": "10-Projects/<project-id>/plans",
  "decisionsDir": "10-Projects/<project-id>/decisions"
}
```

**Updates:** append row to `00-AI/START-HERE.md` active projects table (idempotent).

### In repo (committed)

`.grounder.json`:

```json
{
  "version": 1,
  "projectId": "turborepo-react-starter",
  "vaultRoot": "/Users/you/Documents/obsidian/dev",
  "bridge": "10-Projects/turborepo-react-starter/_project.md"
}
```

Add `.grounder.json` to repo — **yes, commit it** (paths are machine-specific but useful for `status`; consider documenting env override `GROUNDER_VAULT` for other machines).

`.gitignore` — do **not** ignore `.grounder.json`.

---

## Project ID detection

Priority order:

1. `--id` CLI flag
2. `name` from `package.json`
3. Git remote slug (e.g. `turborepo-react-starter` from URL)
4. Basename of repo root directory

Sanitize: lowercase, `[a-z0-9-]` only.

---

## Bridge note template (`_project.md`)

Generated fields:

- `project`, `repo` (absolute), `branch` (current git branch if available)
- `recall` — from README first heading, package description, or project id
- Tables: repo docs (`AGENTS.md`, `docs/` if present, `.ai/plans/` if present)
- Vault folder purposes (static)
- Cursor commands table (`/grounder-task`, …) — link to `00-AI/agent-workflow.md`

**Do not** embed full README or AGENTS.md — link paths only.

---

## Init flow (interactive)

```text
$ npx grounder init

Grounder — connect this repo to your Obsidian dev vault

✓ Git repo detected: /Users/you/dev/my-app
✓ Project id: my-app

Vault: [/Users/you/Documents/obsidian/dev] (from ~/.grounder/config.json)

Will create:
  vault  10-Projects/my-app/_project.md + folders
  vault  00-AI/projects.json (merge entry)
  repo   .grounder.json

Proceed? [Y/n]
```

If no `~/.grounder/config.json`:

```text
No vault configured. Run: npx grounder vault init ~/path/to/vault
Or enter vault path now: _
```

---

## Decisions (locked in)

| # | Decision |
| --- | --- |
| 1 | npm package name **`grounder`**, CLI bin **`grounder`** |
| 2 | Vault layout matches manual prototype (`00-AI`, `10-Projects`, `templates`, `90-Inbox`) |
| 3 | MCP server: **`@bitbonsai/mcpvault`** (filesystem, no Obsidian app required) |
| 4 | Cursor user config only — **no** project `.cursor/mcp.json` for vault (personal) |
| 5 | Repo marker **`.grounder.json`** committed; vault content never in repo |
| 6 | Registry **`00-AI/projects.json`** is source of truth for agent project resolution |
| 7 | Init is **merge/idempotent** — never delete user logs or overwrite `_project.md` without `--force` |
| 8 | TypeScript or plain Node ESM — pick one in Phase 1; prefer **Node 18+**, minimal deps |
| 9 | Templates use `{{date:YYYY-MM-DD}}` placeholders — agents substitute (Templater optional) |
| 10 | Cursor UX = **commands** (trigger) + **rule** (router) + **skill** (procedure) — all installed by `vault init` |
| 11 | Slash command prefix **`grounder-`** — product namespace; separates vault commands from repo commands (e.g. `/grounder-note` vs `/review`) |
| 12 | Vault I/O: **MCP first** (`obsidian-dev`); direct filesystem **fallback only** when MCP unavailable |
| 13 | **No loose text triggers** — vault actions only via `/grounder-*` slash commands (not free-text "handoff", "save note", etc.) |
| 14 | **`/grounder-note` dual mode:** Mode A `/grounder-note <text>` → verbatim body; Mode B `<task> /grounder-note` → agent runs task, note body = output only |
| 15 | **Never overwrite vault files** — new note/plan/decision always; if slug exists append `-HHmm` suffix |
| 16 | **Strict folder separation** — each command writes to one folder only; no mixing (e.g. session summary → `logs/`, not `notes/`) |
| 17 | Cursor artifacts are **user-global** (`~/.cursor/commands`, `rules`, `skills`) — not project `.cursor/` (vault is personal) |
| 18 | User rule **`alwaysApply: true`** — router active even when user types `/grounder-*` manually without command picker |
| 19 | Chat reply vs vault write are **separate** — agent must not dump chat summaries into vault unless Mode B `/grounder-note` or explicit write command |
| 20 | `doctor` checks MCP server listed, `npx` path absolute, and warns when agents would fall back to filesystem (sandbox approval risk) |

### Decision log (2026-06-25)

| # | Change | Why |
| --- | --- | --- |
| 13 | Dropped natural-language session triggers | User confusion; ambiguous routing |
| 14 | `/grounder-note` verbatim vs agent modes | Same command, two intents — prefix vs suffix detection |
| 15 | No overwrite | Protect user-edited notes; test run clobbered `test-note-1.md` |
| 12, 20 | MCP first | Direct Write to vault outside repo workspace triggered Cursor approval + slow path |
| 16 | Enforced in rule + commands | Agent merged "summarize" + "note" into one bloated file |

### Decision log (2026-06-26)

| # | Change | Why |
| --- | --- | --- |
| 21 | Renamed slash prefix **`x-` → `grounder-`**; rule/skill → **`grounder-vault`** | Product-branded namespace; `x-` was generic |

## Non-goals (v1)

- Hosting/sync service (Obsidian Git plugin stays user's choice)
- In-vault RAG / embeddings (MCP search is enough initially)
- Replacing `AGENTS.md` or repo `docs/`
- Claude Desktop / Windsurf config (Cursor first; same JSON shape later)
- Monorepo-aware multi-package init (one bridge per repo root; sub-packages later)

---

## Architecture

```text
┌─────────────────┐     .grounder.json      ┌──────────────────────┐
│  Git project    │ ────────────────────────▶│  Obsidian dev vault  │
│  AGENTS.md      │     projects.json       │  10-Projects/…/      │
│  docs/          │ ◀──── bridge note ──────│  _project.md, logs/  │
└─────────────────┘                         └──────────────────────┘
         │                                            ▲
         │  /grounder-task, /grounder-task-handoff, …               │
         ▼                                            │
┌─────────────────┐    rule + skill + MCP             │
│  Cursor Agent   │ ──────────────────────────────────┘
└─────────────────┘
```

**Package layout (target):**

```text
grounder/
├── package.json          # bin: grounder
├── src/
│   ├── cli.ts            # commander or minimal argv parser
│   ├── commands/
│   │   ├── vault-init.ts
│   │   ├── init.ts
│   │   ├── status.ts
│   │   └── doctor.ts
│   ├── config.ts         # ~/.grounder/config.json
│   ├── detect.ts         # project id, repo root, agents.md paths
│   ├── vault/            # write templates, merge projects.json
│   └── cursor/           # merge mcp.json, write commands, rule, skill
├── templates/
│   ├── vault/            # 00-AI, templates, 90-Inbox
│   ├── bridge/           # _project.md
│   └── cursor/           # grounder-*.md commands (incl. grounder-note dual-mode), grounder-vault.mdc, SKILL.md (MCP-first I/O)
└── test/
```

---

## Phases

### Phase 0 — Repo bootstrap

- [ ] `git init`, `.gitignore`, MIT license, README one-liner
- [ ] Package scaffold: `type: module`, `bin`, `files` for templates
- [ ] `AGENTS.md` for grounder itself (quality loop: test, lint)

### Phase 1 — `vault init`

- [ ] `~/.grounder/config.json` read/write
- [ ] Copy vault templates from `templates/vault/**`
- [ ] Merge `~/.cursor/mcp.json` (preserve existing servers)
- [ ] Install `~/.cursor/commands/grounder-*.md` (six files)
- [ ] Write `~/.cursor/rules/grounder-vault.mdc` if missing
- [ ] Write `~/.cursor/skills/grounder-vault/SKILL.md` if missing
- [ ] Tests: temp HOME, assert files created

### Phase 2 — `init` (core)

- [ ] Detect git root, project id, absolute repo path
- [ ] Require vault from config or prompt
- [ ] Merge `projects.json`
- [ ] Write bridge + project folders
- [ ] Write `.grounder.json` in repo
- [ ] Update START-HERE project table
- [ ] Tests: init twice → no duplicate registry keys; `--force` overwrites bridge

### Phase 3 — `status` + `doctor`

- [ ] `status` — read `.grounder.json`, verify vault files exist
- [ ] `doctor` — vault reachable, MCP config present, npx path valid, registry repo path matches cwd
- [ ] `doctor` — warn if `obsidian-dev` missing (filesystem fallback = sandbox approval on vault writes)

### Phase 4 — Polish + publish

- [ ] README: quickstart (`vault init` → `init` → `/grounder-task` … `/grounder-task-handoff`)
- [ ] `npx grounder@latest` smoke test on clean temp project
- [ ] npm publish (or private registry)

---

## Acceptance criteria

1. Fresh machine: `vault init` + `init` in turborepo clone reproduces manual setup (modulo user-specific paths).
2. Re-run `init` is safe — no duplicate projects, no log deletion.
3. Cursor `/grounder-task` + rule finds project via `projects.json` when workspace is registered repo.
4. `/grounder-task-handoff` writes only to `logs/`; `/grounder-note` only to `notes/` (router enforced).
5. `/grounder-note` Mode A saves verbatim text; Mode B saves agent output only (no instruction echo).
6. Vault writes use MCP when `obsidian-dev` connected; filesystem fallback documented in skill.
7. `.grounder.json` in repo documents connection for teammates (they run `init` with their vault path).
8. `doctor` reports actionable fixes when MCP, commands, or vault missing.

---

## Risks / mitigations

| Risk | Mitigation |
| --- | --- |
| Machine-specific paths in `.grounder.json` | Document `GROUNDER_VAULT` env; `init --relink` |
| Cursor MCP merge breaks user config | Deep-merge `mcpServers`; backup to `mcp.json.grounder-bak` |
| Overwriting edited bridge | Default skip if `_project.md` exists; `--force` flag |
| Agent uses Write tool instead of MCP | Skill + commands require MCP first; doctor warns |
| `npx` not on Cursor PATH | Doctor warns; write absolute path from `which npx` |
| `/grounder-note` mode ambiguity | Command template: leading `/grounder-note` = verbatim; trailing `/grounder-note` = agent mode; ask once if unclear |

---

## Open questions

- [ ] Commit `.grounder.json` with absolute `vaultRoot` vs relative / env-only?
- [ ] Support `~/.config/grounder` on Linux in addition to `~/.grounder`?
- [ ] Monorepo: one bridge per repo root sufficient for v1?

---

## Links

- Manual vault: `~/Documents/obsidian/dev`
- MCP: [@bitbonsai/mcpvault](https://github.com/bitbonsai/mcpvault)
- Prior art: [obsidian-ai-workflow-kit](https://github.com/Moxi-Lab/obsidian-ai-workflow-kit)
- Vault plan copy: `10-Projects/grounder/plans/grounder-init-cli.md`
