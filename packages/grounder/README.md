# Grounder

Connect project folders to a personal Obsidian vault so AI agents (Cursor, Claude Code, etc.) get persistent memory without committing personal docs to the repo.

**Requirements:** Node.js 18+ and an Obsidian vault on disk. Git is optional but used when present (project id detection and link lookup bounds).

## Install

```bash
npm install -g grounder
```

Or run without installing:

```bash
npx grounder --help
```

## Quickstart

```bash
# Once per machine — set vault location + install agent slash commands
grounder vault init ~/Documents/obsidian/dev

# Once per folder — link project id to vault notes folder
cd your-project
grounder init

# Write a note (or use /grounder-note in Cursor / Claude Code)
grounder note "Investigate auth middleware"
```

Notes land in `<vault>/10-Projects/{projectId}/notes/`.

## Setup overview

Three steps — vault once per machine, then link each project folder:

1. **`grounder vault init <path>`** (once per machine)
   - Writes `~/.grounder/config.json` with the vault root
   - Creates `<vault>/10-Projects/` if missing
   - Installs agent slash commands for detected agents (or `--agent=<id>`):
     - Cursor → `~/.cursor/commands/grounder-note.md`
     - Claude Code → `~/.claude/commands/grounder-note.md`

2. **`grounder init`** (once per project folder)
   - Writes `.grounder.json` in the current directory (`projectId` — safe to commit)
   - Creates `<vault>/10-Projects/{projectId}/notes/`

3. **Daily use** — `grounder note "…"` or `/grounder-note` in the agent; no further install.

Nothing is written into the repo except the small `.grounder.json` marker. Agent artifacts stay under the user’s home directory; vault notes stay outside the project tree.

## Commands

```text
grounder vault init <path>   Initialize vault + home config (once per machine)
grounder init                Connect the current folder to your vault
grounder note <text>         Write a note to the vault
grounder path notes          Print resolved notes directory
```

### Init flags

| Flag | Commands | Description |
| --- | --- | --- |
| `--yes` | `vault init`, `init` | Skip confirmation prompts |
| `--force` | `vault init`, `init` | Overwrite existing generated files |
| `--id <id>` | `init` | Override detected project id |
| `--vault <path>` | `init` | Override home vault root for this run |
| `--agent <id>` | `vault init` | Install for a specific agent (repeatable; default: auto-detect). Supported: `cursor`, `claude` |

### Note flags

| Flag | Description |
| --- | --- |
| `--title <slug>` | Note filename slug (default: slugified text) |

Run `grounder --help` for the full reference.

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

`grounder note` and `grounder path notes` walk up from the current directory to find the nearest `.grounder.json`, stopping at the git root when one exists (or at the filesystem root otherwise).

**Environment variables**

| Variable | Description |
| --- | --- |
| `GROUNDER_VAULT` | Override vault root for the current session |
| `GROUNDER_HOME` | Override home directory (default: `~`) for config resolution |

## Agents

The vault layout is agent-agnostic. `grounder vault init` installs thin glue artifacts per detected agent via a pluggable adapter registry (`src/agents/`).

| Agent | Detection | Artifact |
| --- | --- | --- |
| Cursor | `~/.cursor` exists | `~/.cursor/commands/grounder-note.md` |
| Claude Code | `~/.claude` exists | `~/.claude/commands/grounder-note.md` |

No `--agent` flag: auto-detect installed agents. Explicit install:

```bash
grounder vault init ~/Documents/obsidian/dev --agent=cursor --agent=claude
```

Each command tells the agent to run `npx grounder note "…"` from the linked project folder (no global install required). Re-run with `--force` to refresh existing installs.

Templates live under `templates/agents/{id}/`. Adding another agent means one adapter file + one template directory — `vault init` stays agent-blind.

## Development

Source, tests, and contribution workflow live in the [Grounder monorepo](https://github.com/andrej-kolic/grounder).
