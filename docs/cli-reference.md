# CLI reference

Every Grounder command and flag. For the short version, run `grounder -h`; for the
full synopsis, `grounder --help`.

- [Commands](#commands)
- [Setup / link flags](#setup--link-flags)
- [Note / handoff flags](#note--handoff-flags)
- [Plan flags](#plan-flags)
- [Search flags](#search-flags)
- [Doctor flags](#doctor-flags)
- [Status vs doctor](#status-vs-doctor)

See also: [Configuration](configuration.md) · [Upgrading](upgrading.md) ·
[Session-start hooks](session-hooks.md) · [Troubleshooting](troubleshooting.md)

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

Where output lands:

- Notes → `<vault>/10-Projects/{projectId}/notes/`
- Handoffs → `<vault>/10-Projects/{projectId}/logs/` (one file per close; newest
  *usable* file wins — an empty or unreadable newest file falls back to the next one)
- Plans → `<vault>/10-Projects/{projectId}/plans/` (one file per `--title`; overwrite
  only with `--force`)

`plan` is the only living file: re-running the same `--title` with `--force` updates it
in place (preserving `created`), while `note` and `handoff` always write a new dated file.

## Setup / link flags

| Flag             | Commands                        | Description                                                                                       |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `--yes`          | `setup`, `link`                 | Skip confirmation prompts                                                                         |
| `--dry-run`      | `setup`, `link`, `migrate`      | Preview without writing                                                                           |
| `--force`        | `setup`, `link`, `migrate`      | Overwrite existing generated / locally-modified files. On `migrate`, also deletes locally-edited pre-skill `grounder-*.md` command files left over from before 0.6 (edits are not ported — see [Upgrading](upgrading.md)) |
| `--id <id>`      | `link`                          | Override detected project id                                                                      |
| `--vault <path>` | `link`                          | Override home vault root for this run                                                             |
| `--agent <id>`   | `setup`, `migrate`              | Install for a specific agent (repeatable; default: auto-detect). Supported: `cursor`, `claude`    |
| `--hooks`        | `setup`, `migrate`              | Also install session-start teaser hooks (opt-in; see [Session-start hooks](session-hooks.md)) |

Both `setup` and `link` preview what they'll write and ask to confirm; add `--yes` to
skip the prompt (e.g. in scripts), or `--dry-run` to print the same preview without
writing.

For `migrate` flags, see [Upgrading](upgrading.md#migrate-flags).

## Note / handoff flags

| Flag              | Commands                    | Description                                                                                             |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `--title <slug>`  | `note`, `handoff`           | Filename slug (default: slugified text / first line)                                                    |
| `--topics <list>` | `note`, `handoff`           | Comma-separated keywords written to `topics:` frontmatter for search (e.g. `auth,jwt,session`)          |
| `--limit <n>`     | `note list`                 | Max notes to print (default: 5)                                                                         |
| `--limit <n>`     | `handoff list`              | Max handoffs to print (default: 5)                                                                      |
| `--markdown`      | `note list`, `handoff list` | Agent relay: `[bucketRelativePath](fileUri)` title lines (nested e.g. `feature/name.md`; absolute path indented beneath) |
| `--head`          | `handoff list`              | Print only the newest *usable* handoff path — skips empty/unreadable files, same pick as `handoff peek` |

## Plan flags

| Flag              | Commands    | Description                                                                                                                                                |
| ----------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--title <name>`  | `plan`      | Filename stem when creating/updating by name (trailing `.md` ok; sanitized, max 80 chars; no auto-slug). Mutually exclusive with `--path`.                 |
| `--path <file>`   | `plan`      | Update an existing plan by path (must resolve under this project's `plans/`; no title sanitization; always overwrites). Mutually exclusive with `--title`. |
| `--topics <list>` | `plan`      | Comma-separated keywords written to `topics:` frontmatter for search (e.g. `caching,redis,api`). On update, omitting `--topics` keeps existing topics.     |
| `--force`         | `plan`      | With `--title`: overwrite an existing plan (preserves original `created`, sets `updated`). Not used with `--path`.                                         |
| `--limit <n>`     | `plan list` | Max plans to print (default: 5)                                                                                                                            |
| `--markdown`      | `plan list` | Agent relay: `[bucketRelativePath](fileUri)` title lines (nested e.g. `migration/cutover.md`; absolute path indented beneath)                               |

Unlike `note` / `handoff` (always a new dated file), `plan` is living: create or collide
by `--title` (use `--force` to overwrite), or update an existing file in place with
`--path`.

## Search flags

Scoped to the **linked project vault** only (`<vault>/10-Projects/{projectId}/`).
Searches `*.md` under that folder — not the git repo, not sibling projects.

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

`--markdown` and `--json` are mutually exclusive. `/grounder-search` uses `--json` by
default, full-reads the top four hits, and synthesizes a short answer — see
[vault search architecture](architecture/vault-search.md) for contributor details.

## Doctor flags

| Flag       | Description                                    |
| ---------- | ---------------------------------------------- |
| `--global` | Machine-only checks (skip project/link checks) |

## Status vs doctor

| Command           | Job                                                                                          | When to use                                |
| ----------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `grounder status` | Snapshot of Machine (home config + vault path) and Project (link, id, notes/logs/plans, git) | “Am I wired?” — see paths and link state   |
| `grounder doctor` | Health checklist (`ok` / `fail` / `warn`) with fix hints; exit `1` on any fail               | “Why isn’t memory working?” — verify setup |

Both are read-only. `status` exits `0` even when unlinked; `doctor` fails when checks
fail. Use `doctor --global` to check the machine without a project link.

`status` only reads the install ledger (`Schemas: current` / `Schemas: ledger stale` —
it does not open agent command/hook files). `doctor` checks on-disk drift via migrate
dry-run, and also warns when files already match but the ledger schema is still behind,
so both point at `grounder migrate` in that case.
