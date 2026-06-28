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
# Once per machine — set vault location + install /grounder-note in Cursor
grounder vault init ~/Documents/obsidian/dev

# Once per folder — link project id to vault notes folder
cd your-project
grounder init

# Write a note (or use /grounder-note in Cursor)
grounder note "Investigate auth middleware"
```

Notes land in `<vault>/10-Projects/{projectId}/notes/`.

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

## Cursor

`grounder vault init` installs a `/grounder-note` slash command in `~/.cursor/commands/`. It tells the agent to run `npx grounder note "…"` from the linked project folder (no global install required). Re-run `grounder vault init <path> --force` to refresh an existing install.

## Development

Source, tests, and contribution workflow live in the [Grounder monorepo](https://github.com/andrej-kolic/grounder).
