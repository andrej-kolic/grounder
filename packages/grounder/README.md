# Grounder

Connect git projects to a personal Obsidian vault so AI agents (Cursor, Claude Code, etc.) get persistent memory without committing personal docs to the repo.

**Requirements:** Node.js 18+, a git repository, and an Obsidian vault on disk.

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

# Once per repo — link project id to vault notes folder
cd your-git-project
grounder init

# Write a note (or use /grounder-note in Cursor)
grounder note "Investigate auth middleware"
```

Notes land in `<vault>/10-Projects/{projectId}/notes/`.

## Commands

```text
grounder vault init <path>   Initialize vault + home config (once per machine)
grounder init                Connect the current repo to your vault
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

**Repo marker** — `.grounder.json` at the git root (safe to commit):

```json
{ "version": 1, "projectId": "your-project" }
```

Written by `grounder init`. The project id is detected from the git remote or directory name.

**Environment variables**

| Variable | Description |
| --- | --- |
| `GROUNDER_VAULT` | Override vault root for the current session |
| `GROUNDER_HOME` | Override home directory (default: `~`) for config resolution |

## Cursor

`grounder vault init` installs a `/grounder-note` slash command in `~/.cursor/commands/`. Use it in Cursor chat to write notes to the vault for the linked repo.

## Development

Source, tests, and contribution workflow live in the [Grounder monorepo](https://github.com/andrej-kolic/grounder).
