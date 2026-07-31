# Grounder

[![npm version](https://img.shields.io/npm/v/grounder.svg)](https://www.npmjs.com/package/grounder)
[![license](https://img.shields.io/npm/l/grounder.svg)](../../LICENSE)

AI coding agents forget everything between sessions. Grounder gives them persistent memory in a personal Obsidian vault — notes and handoffs live outside the repo, under your control, and never get committed.

- **Private by default** — vault notes live outside the project tree; only a small `projectId` marker is safe to commit
- **Built for agents** — installs `/grounder-note`, `/grounder-task`, `/grounder-task-handoff` slash commands in Cursor and Claude Code
- **Structured handoffs** — end a session with a Done/Next/Blockers/Decisions checkpoint; resume next time by hydrating from it
- **Zero per-project install** — slash commands shell out via `npx`; nothing to add to the repo besides the marker file

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
# Add --hooks for an optional one-line session-start reminder (see Session-start hooks)
grounder vault init <path-to-your-vault>

# Once per project folder — link project id to vault notes/ + logs/
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

`/grounder-task` hydrates the agent from the newest handoff plus `AGENTS.md`; `/grounder-task-handoff` writes the next checkpoint when you close the session. Behind the scenes these run `grounder handoff list` and `grounder handoff <text>` for you — see [Session loop](#session-loop).

No agent, or want to write by hand? The same actions are plain CLI commands:

```bash
grounder note "Investigate auth middleware"      # ad-hoc note
grounder handoff "# Handoff: ...\n\n## Next\n1. ..."  # session checkpoint
grounder handoff list                            # newest handoffs, for manual hydrate
```

Notes land in `<vault>/10-Projects/{projectId}/notes/`.  
Handoffs land in `<vault>/10-Projects/{projectId}/logs/` (one file per close; newest wins).

Inspect or debug setup any time with `grounder status` / `grounder doctor` — see [Troubleshooting](#troubleshooting).

### Session loop

```text
(optional teaser) → /grounder-task → work → /grounder-task-handoff → next session
```

| Slash command | CLI | Role |
| --- | --- | --- |
| `/grounder-note` | `grounder note` | Ad-hoc vault note |
| `/grounder-task-handoff` | `grounder handoff` | Write session checkpoint to `logs/` |
| `/grounder-task` | `grounder handoff list` + read newest | Read-only hydrate from newest handoff + `AGENTS.md` |

With `--hooks` on `vault init`, a new Cursor/Claude session may also print a one-line teaser when a handoff exists — never the full body. See [Session-start hooks](#session-start-hooks).

## Setup overview

- **`grounder vault init <path>`** (once per machine) writes `~/.grounder/config.json`, creates `<vault>/10-Projects/`, and installs slash commands for detected agents (Cursor → `~/.cursor/commands/`, Claude Code → `~/.claude/commands/`; override with `--agent=<id>`).
- **`grounder init`** (once per project folder) writes `.grounder.json` (`projectId` — safe to commit) and creates `<vault>/10-Projects/{projectId}/notes/` and `logs/`.
- **Daily use** — notes, handoffs, and recall via CLI or slash commands; no further install.

Nothing is written into the repo except the small `.grounder.json` marker. Agent artifacts stay under the user’s home directory; vault notes stay outside the project tree.

## Commands

```text
grounder vault init <path>   Initialize vault + home config (once per machine)
grounder init                Connect the current folder to your vault
grounder note <text>         Write a note to the vault
grounder handoff <text>      Write a session handoff to vault logs/
grounder handoff list        Print recent handoff paths (newest first)
grounder handoff peek        One-line latest-handoff teaser (used by session hooks)
grounder path notes          Print resolved notes directory
grounder path logs           Print resolved logs directory
grounder status              Snapshot of machine + project link + resolved paths
grounder doctor              Health checks with fix hints
```

### Init flags

| Flag | Commands | Description |
| --- | --- | --- |
| `--yes` | `vault init`, `init` | Skip confirmation prompts |
| `--force` | `vault init`, `init` | Overwrite existing generated files |
| `--id <id>` | `init` | Override detected project id |
| `--vault <path>` | `init` | Override home vault root for this run |
| `--agent <id>` | `vault init` | Install for a specific agent (repeatable; default: auto-detect). Supported: `cursor`, `claude` |
| `--hooks` | `vault init` | Also install session-start teaser hooks (opt-in; see [Session-start hooks](#session-start-hooks)) |

### Note / handoff flags

| Flag | Commands | Description |
| --- | --- | --- |
| `--title <slug>` | `note`, `handoff` | Filename slug (default: slugified text / first line) |
| `--limit <n>` | `handoff list` | Max paths to print (default: 5) |

### Doctor flags

| Flag | Description |
| --- | --- |
| `--global` | Machine-only checks (skip project/link checks) |

Run `grounder --help` for the full reference.

### Status vs doctor

| Command | Job | When to use |
| --- | --- | --- |
| `grounder status` | Snapshot of Machine (home config + vault path) and Project (link, id, notes/logs, git) | “Am I wired?” — see paths and link state |
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

`grounder note`, `grounder handoff`, and `grounder path *` walk up from the current directory to find the nearest `.grounder.json`, stopping at the git root when one exists (or at the filesystem root otherwise).

**Environment variables**

| Variable | Description |
| --- | --- |
| `GROUNDER_VAULT` | Override vault root for the current session |
| `GROUNDER_HOME` | Override home directory (default: `~`) for config resolution |

## Agents

The vault layout is agent-agnostic. `grounder vault init` installs thin glue artifacts per detected agent via a pluggable adapter registry (`src/agents/`).

| Agent | Detection | Artifacts |
| --- | --- | --- |
| Cursor | `~/.cursor` exists | `~/.cursor/commands/grounder-{note,task,task-handoff}.md` |
| Claude Code | `~/.claude` exists | `~/.claude/commands/grounder-{note,task,task-handoff}.md` |

No `--agent` flag: auto-detect installed agents. Explicit install:

```bash
grounder vault init <path-to-your-vault> --agent=cursor --agent=claude
```

Slash commands tell the agent to run `npx grounder …` from the linked project folder (no global install required). Re-run with `--force` to refresh existing installs.

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

`doctor` reports a `warn` (never a `fail`) when a detected agent has no Grounder hook installed.

Hooks run `~/.grounder/runtime/dist/cli.js` directly (not `npx`), materialized on install:

- **Real install** (`npm i -g grounder`, `pnpm add -g grounder`, or a monorepo checkout) → symlinked. Upgrading overwrites the same path in place, so hooks stay current with **no re-run needed**.
- **Bare `npx grounder vault init --hooks`** (nothing installed) → copied, since each `npx` invocation resolves to a disposable, version-pinned cache dir that can't be symlinked durably. Re-run the same command after upgrading grounder to refresh (no `--force` needed).

If you want hooks that stay current with zero maintenance, install grounder rather than using bare `npx` for this step.

## Troubleshooting

| Symptom | Try |
| --- | --- |
| Not sure if this folder is linked | `grounder status` — check Project `Linked:` and paths |
| Notes / handoffs fail or slash commands missing | `grounder doctor` — follow fix hints |
| Machine setup only (no project yet) | `grounder doctor --global` |
| Home config / vault missing | `grounder vault init <path>` |
| No `.grounder.json` / notes dirs | `grounder init` |
| Agent slash commands stale or partial | `grounder vault init <path> --force` (or `--agent=<id>`) |
| Session-start teaser missing (optional) | `grounder vault init <path> --hooks` — `doctor` warns when absent |

## Development

Source, tests, and contribution workflow live in the [Grounder monorepo](https://github.com/andrej-kolic/grounder).
