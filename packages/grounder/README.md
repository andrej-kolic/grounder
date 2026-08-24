# Grounder

[![npm version](https://img.shields.io/npm/v/grounder.svg)](https://www.npmjs.com/package/grounder)
[![license](https://img.shields.io/npm/l/grounder.svg)](../../LICENSE)

> **Obsidian vault memory for Cursor and Claude Code.**

**Grounder** gives your AI agents shared memory: plans, notes, and session handoffs written as plain markdown into a folder you control — an Obsidian vault, or any directory on disk. Because that memory lives in your files instead of a chat history, work started in one agent can be picked up in another, weeks later, on a different machine. No database, no vectors, no background indexing — just files you can read, diff, and delete.

### Demo

![A session loop: peek teaser, /grounder-task resume, /grounder-plan list, continuing a plan, /grounder-note, /grounder-task-handoff — each with the real grounder CLI call it runs and the vault path it touches](../demo-casts/out/readme.gif)

Dim lines in the GIF are the real `grounder` CLI call behind each command. Regenerated with `pnpm demo:cast` from [`@grounder/demo-casts`](../demo-casts/).

### Slash commands

`grounder link` once per project, then everything runs from your agent's chat:

| Command                  | What it does                                          | CLI it runs                   |
| ------------------------ | ----------------------------------------------------- | ----------------------------- |
| `/grounder-task`         | Pick up where the last session stopped                | `grounder handoff list --head` |
| `/grounder-plan`         | Write or update a living plan that spans sessions     | `grounder plan`               |
| `/grounder-search`       | Find prior context anywhere in this project's vault   | `grounder search`             |
| `/grounder-note`         | Save a one-off note                                   | `grounder note`               |
| `/grounder-task-handoff` | Checkpoint the session before you close it            | `grounder handoff`            |

Slash commands invoke the small runtime `setup` maintains at `~/.grounder/runtime` (see [Agents](#agents)), not whatever `grounder` happens to be on your `PATH`.

### In your vault

```text
10-Projects/your-project/
├── notes/
│   └── 2026-07-21-auth-investigation.md
├── logs/
│   ├── 2026-07-21-091500-auth-middleware.md
│   └── 2026-08-14-103000-auth-middleware.md   ← second session
└── plans/
    └── auth-rewrite.md                        ← living plan
```

The living plan — `plans/auth-rewrite.md`:

```markdown
---
project: "your-project"
created: "2026-07-21T09:15:00Z"
updated: "2026-08-14T10:30:00Z"
topics: ["auth", "middleware", "jwt"]
---

## Goal
Ship the auth rewrite before Q3 cutover.

## Steps
- [x] Map current middleware order
- [ ] Add tests for 401 path
- [ ] Swap in new token validator
```

*`created` and `updated` are different dates — the plan survived a second session, same agent or a different one, same machine or another. Obsidian renders this frontmatter as Properties.*

### Good to know

- **Any project** — a git repo or a plain folder; many projects share one vault.
- **Deliberate, not automatic** — nothing is written or loaded unless you ask. No auto-capture, no RAG.
- **Cursor and Claude Code today** — slash commands for both, more agents on the roadmap.

**Requirements:** Node.js 18+ and a folder to keep the files in — an existing Obsidian vault, or an empty directory Grounder fills as you go. Git is optional (used for project id detection and to bound the link lookup when present).

**Contents:** [Install](#install) · [Upgrading](#upgrading) · [Quickstart](#quickstart) · [Setup overview](#setup-overview) · [Commands](#commands) · [Configuration](#configuration) · [Agents](#agents) · [Session-start hooks](#session-start-hooks) · [Troubleshooting](#troubleshooting) · [Roadmap](#roadmap)

## Install

### npm

```bash
npm install -g grounder
```

Or run without installing: `npx grounder --help`. A global install lets `setup` symlink `~/.grounder/runtime` so it tracks upgrades; bare `npx` copies it instead, so you need `grounder migrate` after every upgrade.

### Agent skill (install + setup in one shot)

```bash
npx skills add andrej-kolic/grounder --skill grounder-setup -g
```

Adding the skill only loads instructions — it does **nothing** until you ask your agent to run it (e.g. "set up grounder").

`grounder -h` prints a short synopsis; `grounder --help` (or `grounder help`) prints the full reference; `grounder -v` prints the installed version.

## Upgrading

After upgrading the package, refresh agent installs:

```bash
grounder migrate
```

Run `grounder doctor` if you’re unsure — it hints when plain `migrate` is enough vs `migrate --force` (needed **once** when upgrading from Grounder before 0.3, or when command files were edited locally). Most grounder commands and session-start teasers will also tell you when a migrate is due. Flag details: [Migrate flags](#migrate-flags).

## Quickstart

**1. One-time setup:**

```bash
# Once per machine — connect to a markdown vault + install agent slash commands
# --hooks adds an optional one-line session-start reminder (see Session-start hooks)
grounder setup <path-to-your-vault> --hooks

# Once per project folder — link project id to vault notes/ + logs/ + plans/
cd your-project
grounder link
```

Both commands preview what they'll write and ask to confirm; add `--yes` to skip the prompt (e.g. in scripts), or `--dry-run` to print the same preview without writing.

**2. Daily use — from your agent's chat.** A session usually recalls first and checkpoints last; what happens in between is up to you:

```text
> /grounder-task
  Reading logs/2026-07-21-091500-auth-middleware.md + AGENTS.md
  Done: mapped middleware order. Next: add tests for the 401 path.

> /grounder-plan the auth rewrite — 401 tests done, validator swap next
  Updating plan at plans/auth-rewrite.md

> /grounder-search how did we handle token refresh before
  4 hits under notes/ and logs/ — summarized above, nothing else loaded

> /grounder-task-handoff
  Wrote logs/2026-07-28-143200-auth-middleware.md
```

`/grounder-task` reads the newest *usable* handoff plus `AGENTS.md` — nothing else. `/grounder-plan` keeps a single file current across sessions instead of scattering updates through handoffs. `/grounder-task-handoff` writes the checkpoint the next session reads.

No agent, or want to write by hand? The same actions are plain CLI commands:

```bash
grounder note "Investigate auth middleware"           # ad-hoc note
grounder handoff $'# Handoff: ...\n\n## Next\n1. ...' # session checkpoint
grounder handoff list                                 # newest handoffs, for manual hydrate
grounder plan $'# Goal\n\nShip it' --title phase-1    # named living plan
```

- Notes land in `<vault>/10-Projects/{projectId}/notes/`.
- Handoffs land in `<vault>/10-Projects/{projectId}/logs/` (one file per close; newest *usable* file wins — an empty or unreadable newest file falls back to the next one).
- Plans land in `<vault>/10-Projects/{projectId}/plans/` (one file per `--title`; overwrite only with `--force`).

Handoffs and plans include YAML frontmatter (`project`, `created`, `branch`, `topics`) that Obsidian renders as Properties — browsable, searchable, and queryable without plugins.

`plan` is the only living file: re-running the same `--title` with `--force` updates it in place (preserving `created`), while `note` and `handoff` always write a new dated file.

Inspect or debug setup any time with `grounder status` / `grounder doctor` — see [Troubleshooting](#troubleshooting).

With `--hooks` on `setup`, a new Cursor or Claude Code session prints a one-line teaser when a handoff exists — never the full body. See [Session-start hooks](#session-start-hooks).

## Setup overview

- `grounder setup <path>` (once per machine) writes `~/.grounder/config.json`, creates `<vault>/10-Projects/`, and installs slash commands for detected agents (Cursor → `~/.cursor/commands/`, Claude Code → `~/.claude/commands/`; override with `--agent=<id>`).
- `grounder link` (once per project folder) writes `.grounder.json` (`projectId` — safe to commit) and creates `<vault>/10-Projects/{projectId}/notes/`, `logs/`, and `plans/`.
- **Daily use** — notes, handoffs, plans, and recall via CLI or slash commands; no further install.

Nothing is written into the repo except the small `.grounder.json` marker. Agent artifacts stay under the user’s home directory; vault notes stay outside the project tree.

## Commands

Same grouping as `grounder -h`:

```text
Setup
  grounder setup <path>         Connect this machine to a vault folder (once)
  grounder link                 Link this project into the vault (once per project)

Write
  grounder plan <text>          Write/update a named living plan under plans/
  grounder note <text>          Write a note under notes/
  grounder handoff <text>       Write a session checkpoint under logs/
  grounder plan list            Recent plans, newest first
  grounder note list            Recent notes, newest first
  grounder handoff list         Recent handoffs, newest first
  grounder handoff list --head  Newest usable handoff path (what /grounder-task reads)

Retrieve
  grounder search <query>       Rank matching files in this project's vault

Paths
  grounder path notes           Print resolved notes directory
  grounder path logs            Print resolved logs directory
  grounder path plans           Print resolved plans directory

Maintain
  grounder status               Machine + project link snapshot
  grounder doctor               Health checks with fix hints
  grounder migrate              Refresh agent install after upgrading grounder

Advanced
  grounder handoff peek         One-line latest-handoff teaser (session hooks)
```



### Setup / link flags


| Flag             | Commands                        | Description                                                                                       |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `--yes`          | `setup`, `link`                 | Skip confirmation prompts                                                                         |
| `--dry-run`      | `setup`, `link`, `migrate`      | Preview without writing                                                                           |
| `--force`        | `setup`, `link`, `migrate`      | Overwrite existing generated / locally-modified files                                             |
| `--id <id>`      | `link`                          | Override detected project id                                                                      |
| `--vault <path>` | `link`                          | Override home vault root for this run                                                             |
| `--agent <id>`   | `setup`, `migrate`              | Install for a specific agent (repeatable; default: auto-detect). Supported: `cursor`, `claude`    |
| `--hooks`        | `setup`, `migrate`              | Also install session-start teaser hooks (opt-in; see [Session-start hooks](#session-start-hooks)) |




### Migrate flags


| Flag           | Description                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `--force`      | Overwrite slash command files you edited locally; also needed **once** when upgrading from Grounder before 0.3 |
| `--dry-run`    | Preview without writing                                                                                        |
| `--agent <id>` | Limit to a specific agent (repeatable)                                                                         |
| `--hooks`      | Install hooks even if they were never installed before                                                         |


See [Upgrading](#upgrading) for the usual post-package-upgrade flow. Untouched command files update automatically; locally edited ones (and pre-0.3 installs with no ledger) are skipped unless you pass `--force`.

### Note / handoff flags


| Flag             | Commands                    | Description                                                                                             |
| ---------------- | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `--title <slug>` | `note`, `handoff`           | Filename slug (default: slugified text / first line)                                                    |
| `--topics <list>` | `note`, `handoff`          | Comma-separated keywords written to `topics:` frontmatter for search (e.g. `auth,jwt,session`)         |
| `--limit <n>`    | `note list`                 | Max notes to print (default: 5)                                                                         |
| `--limit <n>`    | `handoff list`              | Max handoffs to print (default: 5)                                                                      |
| `--markdown`     | `note list`, `handoff list` | Agent relay: `[bucketRelativePath](fileUri)` title lines (nested e.g. `feature/name.md`; absolute path indented beneath) |
| `--head`         | `handoff list`              | Print only the newest *usable* handoff path — skips empty/unreadable files, same pick as `handoff peek` |




### Plan flags


| Flag             | Commands    | Description                                                                                                                                                |
| ---------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--title <name>` | `plan`      | Filename stem when creating/updating by name (trailing `.md` ok; sanitized, max 80 chars; no auto-slug). Mutually exclusive with `--path`.                 |
| `--path <file>`  | `plan`      | Update an existing plan by path (must resolve under this project's `plans/`; no title sanitization; always overwrites). Mutually exclusive with `--title`. |
| `--topics <list>` | `plan`     | Comma-separated keywords written to `topics:` frontmatter for search (e.g. `caching,redis,api`). On update, omitting `--topics` keeps existing topics. |
| `--force`        | `plan`      | With `--title`: overwrite an existing plan (preserves original `created`, sets `updated`). Not used with `--path`.                                         |
| `--limit <n>`    | `plan list` | Max plans to print (default: 5)                                                                                                                            |
| `--markdown`     | `plan list` | Agent relay: `[bucketRelativePath](fileUri)` title lines (nested e.g. `migration/cutover.md`; absolute path indented beneath)                               |


Unlike `note` / `handoff` (always a new dated file), `plan` is living: create or collide by `--title` (use `--force` to overwrite), or update an existing file in place with `--path`.

### Search flags

Scoped to the **linked project vault** only (`<vault>/10-Projects/{projectId}/`). Searches `*.md` under that folder — not the git repo, not sibling projects.

```bash
grounder search "handling migrations of slash commands" \
  --terms "slash commands,grounder migrate,commandsSchema,state.json,hash drift" \
  --json
```

| Flag | Description |
| --- | --- |
| `--terms <csv>` | Extra keyword variants (comma-separated). Dominates ranking quality for agent use. |
| `--limit <n>` | Max files to print (default: 10) |
| `--max-hits <n>` | Max line snippets stored per file during scan (default: 50). Does not stop the tree walk. |
| `--context <n>` | Context lines around each snippet (default: 1) |
| `--since <date>` | Only files modified on or after date (`YYYY-MM-DD` local midnight, or `7d`, `30d`, …) |
| `--after <date>` | Alias for `--since` |
| `--markdown` | `file://` links + fenced snippets (lookup / exact-mention relay) |
| `--json` | Structured hits for agents (`relativePath`, `fileUri`, `termHitCounts`, …) |

`--markdown` and `--json` are mutually exclusive. `/grounder-search` uses `--json` by default, full-reads the top four hits, and synthesizes a short answer — see [vault search architecture](https://github.com/andrej-kolic/grounder/blob/main/docs/architecture/vault-search.md) in the monorepo for contributor details.

### Doctor flags


| Flag       | Description                                    |
| ---------- | ---------------------------------------------- |
| `--global` | Machine-only checks (skip project/link checks) |


Run `grounder --help` for the full reference.

### Status vs doctor


| Command           | Job                                                                                          | When to use                                |
| ----------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `grounder status` | Snapshot of Machine (home config + vault path) and Project (link, id, notes/logs/plans, git) | “Am I wired?” — see paths and link state   |
| `grounder doctor` | Health checklist (`ok` / `fail` / `warn`) with fix hints; exit `1` on any fail               | “Why isn’t memory working?” — verify setup |


Both are read-only. `status` exits `0` even when unlinked; `doctor` fails when checks fail. Use `doctor --global` to check the machine without a project link.

`status` only reads the install ledger (`Schemas: current` / `Schemas: ledger stale` — it does not open agent command/hook files). `doctor` checks on-disk drift via migrate dry-run, and also warns when files already match but the ledger schema is still behind, so both point at `grounder migrate` in that case.

## Configuration

**Machine config** — `~/.grounder/config.json`:

```json
{ "vaultRoot": "/path/to/your/vault" }
```

Written by `grounder setup`. Holds the vault path for this machine only.

**Link marker** — `.grounder.json` in the folder where you run `grounder link` (safe to commit):

```json
{ "version": 1, "projectId": "your-project" }
```

Written by `grounder link` in the **current working directory**. Project id detection (when `--id` is omitted): `package.json` name in that folder → git `origin` remote (if inside a git repo) → folder basename.

`grounder note`, `grounder handoff`, `grounder plan`, `grounder search`, and `grounder path *` walk up from the current directory to find the nearest `.grounder.json`, stopping at the git root when one exists (or at the filesystem root otherwise).

**Environment variables**


| Variable         | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `GROUNDER_VAULT` | Override vault root for the current session                  |
| `GROUNDER_HOME`  | Override home directory (default: `~`) for config resolution |




## Agents

The vault layout is agent-agnostic. `grounder setup` installs thin glue artifacts per detected agent via a pluggable adapter registry (`src/agents/`).


| Agent       | Detection          | Artifacts                                                      |
| ----------- | ------------------ | -------------------------------------------------------------- |
| Cursor      | `~/.cursor` exists | `~/.cursor/commands/grounder-{note,search,task,task-handoff,plan}.md` |
| Claude Code | `~/.claude` exists | `~/.claude/commands/grounder-{note,search,task,task-handoff,plan}.md` |


No `--agent` flag: auto-detect installed agents. Explicit install:

```bash
grounder setup <path-to-your-vault> --agent=cursor --agent=claude
```

Slash commands invoke `~/.grounder/runtime/dist/cli.js` directly (not `npx`) — see [Session-start hooks](#session-start-hooks) for how that runtime stays current. Command files that still match what Grounder last wrote are refreshed by `grounder migrate` without `--force`. Locally edited files are left alone unless you pass `--force`.

After upgrading the package, see [Upgrading](#upgrading). `setup --force` still works for scripts that already use it; it shares the same install path as `migrate`.

Templates live under `templates/agents/{id}/`. Adding another agent means one adapter file + one template directory — `setup` stays agent-blind.

## Session-start hooks

Opt-in safety net for the session loop: when a Cursor or Claude Code session starts in a linked project that already has a handoff, Grounder prints **one line** reminding you it exists. You (or the agent) still decide whether to run `/grounder-task`.

```bash
grounder setup <path-to-your-vault> --hooks
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

Hooks *and* slash commands both run `~/.grounder/runtime/dist/cli.js` directly (never `npx`) — `setup` materializes it, regardless of whether `--hooks` is passed:

- **Real install** (`npm i -g grounder`, `pnpm add -g grounder`, or a monorepo checkout) → symlinked. Upgrading overwrites the same path in place, so both stay current with **no re-run needed**.
- **Bare** `npx grounder setup …` (nothing installed) → copied, since each `npx` invocation resolves to a disposable, version-pinned cache dir that can't be symlinked durably. Re-run `grounder migrate` (or `setup`) after upgrading grounder to refresh (no `--force` needed).

If you want the runtime to stay current with zero maintenance, install grounder rather than using bare `npx` for this step.

That refresh only touches the shared runtime, not installed command files — see [Upgrading](#upgrading) if `doctor` flags command drift.

## Troubleshooting


| Symptom                                                                                | Try                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not sure if this folder is linked                                                      | `grounder status` — check Project `Linked:` and paths                                                                                                |
| Notes / handoffs / plans fail or slash commands missing                                | `grounder doctor` — follow fix hints                                                                                                                 |
| Machine setup only (no project yet)                                                    | `grounder doctor --global`                                                                                                                           |
| Home config / vault missing                                                            | `grounder setup <path>`                                                                                                                              |
| No `.grounder.json` / notes / logs / plans dirs                                        | `grounder link`                                                                                                                                      |
| Agent slash commands drifted (`doctor` warns)                                          | Follow the hint: plain `grounder migrate` when files would auto-update; `grounder migrate --force` when locally modified (also typical once when upgrading from before 0.3) |
| Session-start teaser missing (optional)                                                | `grounder migrate --hooks` — `doctor` warns when absent                                                                                              |
| Shared runtime stale after upgrade (bare npx install)                                  | `grounder migrate` — `doctor` warns when `hook-runtime` is stale                                                                                     |
| Migrate skips all commands as locally modified (first run after upgrade)               | `grounder migrate --force` once, then plain `migrate` on later upgrades                                                                              |
| Node binary gone / not executable (`doctor` fails on hook or command interpreter path) | `grounder migrate` (add `--force` if command files were edited or you’re still on a pre-0.3 install)                                                 |




## Roadmap

- **Support for Copilot, Codex, and other popular agents** — expand beyond Cursor and Claude Code so more agent tools can use the same vault memory.
- **Auto-draft handoff on session end** (under consideration) — a hook that has the agent write the same structured Done/Next/Blockers checkpoint automatically, instead of requiring `/grounder-task-handoff`.

## Development

Source, tests, and contribution workflow live in the [Grounder monorepo](https://github.com/andrej-kolic/grounder).