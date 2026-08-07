# Grounder

[![npm version](https://img.shields.io/npm/v/grounder.svg)](https://www.npmjs.com/package/grounder)
[![license](https://img.shields.io/npm/l/grounder.svg)](../../LICENSE)

AI coding agents forget everything between sessions. Grounder gives them persistent memory in a personal Obsidian vault — notes, handoffs, and plans live outside the repo, under your control, and never get committed.

- **Private by default** — vault notes live outside the project tree; only a small `projectId` marker is safe to commit
- **Built for agents** — installs `/grounder-note`, `/grounder-task`, `/grounder-task-handoff`, `/grounder-plan` slash commands in Cursor and Claude Code
- **Structured handoffs** — end a session with a Done/Next/Blockers/Decisions checkpoint; resume next time by hydrating from it
- **Named plans** — living docs under `plans/` you update in place (`--force` to overwrite; unlike dated notes/handoffs)
- **Zero per-project install** — slash commands run through a small per-machine runtime that `vault init` keeps current; nothing to add to the repo besides the marker file

**Requirements:** Node.js 18+ and an Obsidian vault on disk. Git is optional but used when present (project id detection and link lookup bounds).

**Contents:** [Install](#install) · [Quickstart](#quickstart) · [Setup overview](#setup-overview) · [Commands](#commands) · [Configuration](#configuration) · [Agents](#agents) · [Session-start hooks](#session-start-hooks) · [Troubleshooting](#troubleshooting)

## Install

```bash
npm install -g grounder
```

Or run without installing:

```bash
npx grounder --help
```

`grounder -h` prints the full reference; `grounder -v` prints the installed version.

## Quickstart

**1. One-time setup:**

```bash
# Once per machine — set vault location + install agent slash commands
# --hooks adds an optional one-line session-start reminder (see Session-start hooks)
grounder vault init <path-to-your-vault> --hooks

# Once per project folder — link project id to vault notes/ + logs/ + plans/
cd your-project
grounder init
```

Both commands preview what they'll write and ask to confirm; add `--yes` to skip the prompt (e.g. in scripts).

**2. Daily use — from your agent's chat:**

```text
> /grounder-task

  Reading latest handoff… (logs/2026-07-21-091500-auth-middleware.md)
  Done: mapped middleware order.
  Next: 1. Add tests for 401 path
  Starting on tests for the 401 path now.

> ...you work with the agent...

> /grounder-task-handoff

  Wrote handoff → <vault>/10-Projects/your-project/logs/2026-07-28-143200-auth-middleware.md
```

`/grounder-task` hydrates the agent from the newest *usable* handoff plus `AGENTS.md`; `/grounder-task-handoff` writes the next checkpoint when you close the session. Behind the scenes these run `grounder handoff list --head` and `grounder handoff <text>` for you — see [Session loop](#session-loop).

No agent, or want to write by hand? The same actions are plain CLI commands:

```bash
grounder note "Investigate auth middleware"      # ad-hoc note
grounder handoff "# Handoff: ...\n\n## Next\n1. ..."  # session checkpoint
grounder handoff list                            # newest handoffs, for manual hydrate
grounder plan "# Goal\n\nShip it" --title phase-1  # named living plan
```

Notes land in `<vault>/10-Projects/{projectId}/notes/`.  
Handoffs land in `<vault>/10-Projects/{projectId}/logs/` (one file per close; newest *usable* file wins — an empty or unreadable newest file falls back to the next one).  
Plans land in `<vault>/10-Projects/{projectId}/plans/` (one file per `--title`; overwrite only with `--force`).

Unlike `note` (one-off) and `handoff` (per-session checkpoint), `plan` is for anything spanning multiple sessions — write it once with the goal + steps, then re-run with `--force` as the work progresses to keep one file current instead of scattering updates across handoffs.

Inspect or debug setup any time with `grounder status` / `grounder doctor` — see [Troubleshooting](#troubleshooting).

### Session loop

```text
(optional teaser) → /grounder-task → work → /grounder-task-handoff → next session
```

| Slash command | Equivalent CLI | Role |
| --- | --- | --- |
| `/grounder-note` | `grounder note` | Ad-hoc vault note |
| `/grounder-task-handoff` | `grounder handoff` | Write session checkpoint to `logs/` |
| `/grounder-task` | `grounder handoff list --head` + read it | Read-only hydrate from newest usable handoff + `AGENTS.md` |
| `/grounder-plan` | `grounder plan` | Named living plan under `plans/` |

The "Equivalent CLI" column is what you'd type by hand — under the hood, slash commands invoke a small runtime `vault init` maintains at `~/.grounder/runtime` (see [Agents](#agents)), not whatever `grounder` binary happens to be on your `PATH`.

With `--hooks` on `vault init`, a new Cursor/Claude session may also print a one-line teaser when a handoff exists — never the full body. See [Session-start hooks](#session-start-hooks).

## Setup overview

- **`grounder vault init <path>`** (once per machine) writes `~/.grounder/config.json`, creates `<vault>/10-Projects/`, and installs slash commands for detected agents (Cursor → `~/.cursor/commands/`, Claude Code → `~/.claude/commands/`; override with `--agent=<id>`).
- **`grounder init`** (once per project folder) writes `.grounder.json` (`projectId` — safe to commit) and creates `<vault>/10-Projects/{projectId}/notes/`, `logs/`, and `plans/`.
- **Daily use** — notes, handoffs, plans, and recall via CLI or slash commands; no further install.

Nothing is written into the repo except the small `.grounder.json` marker. Agent artifacts stay under the user’s home directory; vault notes stay outside the project tree.

## Commands

```text
grounder vault init <path>   Initialize vault + home config (once per machine)
grounder init                Connect the current folder to your vault
grounder note <text>         Write a note to the vault
grounder handoff <text>      Write a session handoff to vault logs/
grounder handoff list        Print recent handoff paths (newest first)
grounder handoff list --head Print only the newest usable handoff path
grounder handoff peek        One-line latest-handoff teaser (used by session hooks)
grounder plan <text>         Write/update a named plan under vault plans/
grounder path notes          Print resolved notes directory
grounder path logs           Print resolved logs directory
grounder path plans          Print resolved plans directory
grounder status              Snapshot of machine + project link + resolved paths
grounder doctor              Health checks with fix hints
grounder migrate             Refresh agent install after upgrading grounder
```

### Init flags

| Flag | Commands | Description |
| --- | --- | --- |
| `--yes` | `vault init`, `init` | Skip confirmation prompts |
| `--force` | `vault init`, `init`, `migrate` | Overwrite existing generated / locally-modified files |
| `--id <id>` | `init` | Override detected project id |
| `--vault <path>` | `init` | Override home vault root for this run |
| `--agent <id>` | `vault init`, `migrate` | Install for a specific agent (repeatable; default: auto-detect). Supported: `cursor`, `claude` |
| `--hooks` | `vault init`, `migrate` | Also install session-start teaser hooks (opt-in; see [Session-start hooks](#session-start-hooks)) |

### Migrate flags

| Flag | Description |
| --- | --- |
| `--force` | Overwrite slash command files you edited locally |
| `--dry-run` | Preview without writing |
| `--agent <id>` | Limit to a specific agent (repeatable) |
| `--hooks` | Install hooks even if they were never installed before |

After upgrading the grounder package, run `grounder migrate` to refresh slash commands and (when previously installed) session hooks. Untouched command files update automatically; locally edited ones are skipped unless you pass `--force`.

### Note / handoff flags

| Flag | Commands | Description |
| --- | --- | --- |
| `--title <slug>` | `note`, `handoff` | Filename slug (default: slugified text / first line) |
| `--limit <n>` | `handoff list` | Max paths to print (default: 5) |
| `--head` | `handoff list` | Print only the newest *usable* handoff path — skips empty/unreadable files, same pick as `handoff peek` |

### Plan flags

| Flag | Commands | Description |
| --- | --- | --- |
| `--title <name>` | `plan` | **Required** filename (trailing `.md` ok; sanitized, max 80 chars; no auto-slug) |
| `--force` | `plan` | Overwrite an existing plan (preserves original `created`, sets `updated`) |

Unlike `note` / `handoff` (always a new dated file), `plan` is name-addressed: without `--force`, a second write to the same title refuses and exits 1.

### Doctor flags

| Flag | Description |
| --- | --- |
| `--global` | Machine-only checks (skip project/link checks) |

Run `grounder --help` for the full reference.

### Status vs doctor

| Command | Job | When to use |
| --- | --- | --- |
| `grounder status` | Snapshot of Machine (home config + vault path) and Project (link, id, notes/logs/plans, git) | “Am I wired?” — see paths and link state |
| `grounder doctor` | Health checklist (`ok` / `fail` / `warn`) with fix hints; exit `1` on any fail | “Why isn’t memory working?” — verify setup |

Both are read-only. `status` exits `0` even when unlinked; `doctor` fails when checks fail. Use `doctor --global` to check the machine without a project link.

## Configuration

**Machine config** — `~/.grounder/config.json`:

```json
{ "vaultRoot": "/path/to/your/vault" }
```

Written by `grounder vault init`. Holds the vault path for this machine only.

**Link marker** — `.grounder.json` in the folder where you run `grounder init` (safe to commit):

```json
{ "version": 1, "projectId": "your-project" }
```

Written by `grounder init` in the **current working directory**. Project id detection (when `--id` is omitted): `package.json` name in that folder → git `origin` remote (if inside a git repo) → folder basename.

`grounder note`, `grounder handoff`, `grounder plan`, and `grounder path *` walk up from the current directory to find the nearest `.grounder.json`, stopping at the git root when one exists (or at the filesystem root otherwise).

**Environment variables**

| Variable | Description |
| --- | --- |
| `GROUNDER_VAULT` | Override vault root for the current session |
| `GROUNDER_HOME` | Override home directory (default: `~`) for config resolution |

## Agents

The vault layout is agent-agnostic. `grounder vault init` installs thin glue artifacts per detected agent via a pluggable adapter registry (`src/agents/`).

| Agent | Detection | Artifacts |
| --- | --- | --- |
| Cursor | `~/.cursor` exists | `~/.cursor/commands/grounder-{note,task,task-handoff,plan}.md` |
| Claude Code | `~/.claude` exists | `~/.claude/commands/grounder-{note,task,task-handoff,plan}.md` |

No `--agent` flag: auto-detect installed agents. Explicit install:

```bash
grounder vault init <path-to-your-vault> --agent=cursor --agent=claude
```

Slash commands invoke `~/.grounder/runtime/dist/cli.js` directly (not `npx`) — see [Session-start hooks](#session-start-hooks) for how that runtime stays current. Command files that still match what Grounder last wrote are refreshed by `grounder migrate` without `--force`. Locally edited files are left alone unless you pass `--force`.

- **Upgrading grounder** — run `grounder migrate` (or `grounder doctor` and follow the hint). Legacy installs without an install ledger are treated as schema 0 and get the same hint.
- **`vault init --force`** still works for scripts that already use it; it shares the same install path as `migrate`.

Templates live under `templates/agents/{id}/`. Adding another agent means one adapter file + one template directory — `vault init` stays agent-blind.

## Session-start hooks

Opt-in safety net for the session loop: when a Cursor or Claude Code session starts in a linked project that already has a handoff, Grounder prints **one line** reminding you it exists. You (or the agent) still decide whether to run `/grounder-task`.

```bash
grounder vault init <path-to-your-vault> --hooks
```

Example teaser:

```text
[grounder] Latest handoff: "auth middleware" (2026-07-28). Run /grounder-task to load it, or ignore if unrelated.
```

What hooks do **not** do:

- They never auto-load the full handoff body into context
- They never block or delay a session from starting
- Unlinked folders and projects with no handoffs print nothing (exit 0, silent)

`doctor` reports a `warn` (never a `fail`) when a detected agent has no Grounder hook installed, and when `~/.grounder/runtime` is stale or missing.

Hooks *and* slash commands both run `~/.grounder/runtime/dist/cli.js` directly (never `npx`) — `vault init` materializes it, regardless of whether `--hooks` is passed:

- **Real install** (`npm i -g grounder`, `pnpm add -g grounder`, or a monorepo checkout) → symlinked. Upgrading overwrites the same path in place, so both stay current with **no re-run needed**.
- **Bare `npx grounder vault init …`** (nothing installed) → copied, since each `npx` invocation resolves to a disposable, version-pinned cache dir that can't be symlinked durably. Re-run `grounder migrate` (or `vault init`) after upgrading grounder to refresh (no `--force` needed).

If you want the runtime to stay current with zero maintenance, install grounder rather than using bare `npx` for this step.

That refresh only touches the shared runtime, not installed command files — see the migration note in [Agents](#agents) if `doctor` flags stale command schemas.

## Troubleshooting

| Symptom | Try |
| --- | --- |
| Not sure if this folder is linked | `grounder status` — check Project `Linked:` and paths |
| Notes / handoffs / plans fail or slash commands missing | `grounder doctor` — follow fix hints |
| Machine setup only (no project yet) | `grounder doctor --global` |
| Home config / vault missing | `grounder vault init <path>` |
| No `.grounder.json` / notes / logs / plans dirs | `grounder init` |
| Agent slash commands stale or partial | `grounder migrate` (add `--force` if you edited command files locally) |
| Session-start teaser missing (optional) | `grounder migrate --hooks` — `doctor` warns when absent |
| Shared runtime stale after upgrade (bare npx install) | `grounder migrate` — `doctor` warns when `hook-runtime` is stale |
| Switched Node version / nvm environment (command files invoke the old `node`) | `grounder migrate` — command files bake in the `node` path at install time; session hooks self-heal on migrate without `--force` |

## Development

Source, tests, and contribution workflow live in the [Grounder monorepo](https://github.com/andrej-kolic/grounder).
