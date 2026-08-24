# Configuration

Grounder keeps two pieces of state: one per machine (where the vault is) and one per
project (which vault folder it maps to). Nothing else is persisted.

- [Machine config](#machine-config)
- [Link marker](#link-marker)
- [How commands find the project](#how-commands-find-the-project)
- [Environment variables](#environment-variables)
- [Agents](#agents)

See also: [CLI reference](cli-reference.md) · [Upgrading](upgrading.md) ·
[Session-start hooks](session-hooks.md) · [Troubleshooting](troubleshooting.md)

## Machine config

`~/.grounder/config.json`:

```json
{ "vaultRoot": "/path/to/your/vault" }
```

Written by `grounder setup`. Holds the vault path for this machine only — it is not
committed anywhere, so each machine can keep its vault wherever it likes.

`grounder setup <path>` also creates `<vault>/10-Projects/` and installs slash commands
for detected agents (Cursor → `~/.cursor/commands/`, Claude Code → `~/.claude/commands/`;
override with `--agent=<id>`).

## Link marker

`.grounder.json` in the folder where you run `grounder link` — safe to commit:

```json
{ "version": 1, "projectId": "your-project" }
```

`grounder link` writes it in the **current working directory** and creates
`<vault>/10-Projects/{projectId}/notes/`, `logs/`, and `plans/`.

Project id detection (when `--id` is omitted):

1. `package.json` name in that folder
2. git `origin` remote (if inside a git repo)
3. folder basename

Nothing else is written into the repo. Agent artifacts stay under your home directory;
vault content stays outside the project tree.

## How commands find the project

`grounder note`, `grounder handoff`, `grounder plan`, `grounder search`, and
`grounder path *` walk up from the current directory to find the nearest
`.grounder.json`, stopping at the git root when one exists (or at the filesystem root
otherwise). That means they work from any subdirectory of a linked project.

## Environment variables

| Variable         | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `GROUNDER_VAULT` | Override vault root for the current session                  |
| `GROUNDER_HOME`  | Override home directory (default: `~`) for config resolution |

## Agents

The vault layout is agent-agnostic. `grounder setup` installs thin glue artifacts per
detected agent via a pluggable adapter registry (`src/agents/`).

| Agent       | Detection          | Artifacts                                                      |
| ----------- | ------------------ | -------------------------------------------------------------- |
| Cursor      | `~/.cursor` exists | `~/.cursor/commands/grounder-{note,search,task,task-handoff,plan}.md` |
| Claude Code | `~/.claude` exists | `~/.claude/commands/grounder-{note,search,task,task-handoff,plan}.md` |

With no `--agent` flag, `setup` auto-detects installed agents. To install explicitly:

```bash
grounder setup <path-to-your-vault> --agent=cursor --agent=claude
```

Slash commands invoke `~/.grounder/runtime/dist/cli.js` directly (not `npx`) — see
[Upgrading](upgrading.md#the-shared-runtime) for how that runtime stays current. Command
files that still match what Grounder last wrote are refreshed by `grounder migrate`
without `--force`; locally edited files are left alone unless you pass `--force`.

Templates live under `packages/grounder/templates/agents/{id}/`. Adding another agent
means one adapter file plus one template directory — `setup` stays agent-blind.
