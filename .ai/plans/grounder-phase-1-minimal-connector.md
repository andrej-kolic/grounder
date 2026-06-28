# Plan: Grounder Phase 1 — Minimal project–vault connector

**Status:** Complete  
**Repo:** `/Users/andrejkolic/dev/rey/grounder`  
**Created:** 2026-06-26  
**Updated:** 2026-06-27 (link resolution: cwd init + walk-up for `.grounder.json`)  
**Scope:** Minimal connection + `grounder note` + `/grounder-note` trigger (Cursor)  
**Supersedes for v1:** `.ai/plans/grounder-init-cli.md` (full plan remains reference for later phases)

## How to run (new chat)

Phase 1 is **complete**. For follow-up work, start from `.ai/plans/grounder-init-cli.md` (Phase 2+).

```text
Continue Grounder from Phase 2 per .ai/plans/grounder-init-cli.md.
```

---

## Goal

Connect a project folder to a personal Obsidian vault so a **Cursor agent** can save a note to the vault via the **Grounder CLI**.

**In scope:** connector config, init commands, `grounder note`, thin `/grounder-note` slash command.  
**Out of scope:** MCP, bridge note, logs/handoffs, other slash commands, vault registry, rules/skills, `status`, `doctor`.

---

## Problem

Agent runs in a repo workspace; memory lives in a personal vault on disk. Something must resolve:

```text
workspace  →  vault root  +  project id  →  notes folder  →  write .md file
```

Phase 1 automates **wiring** (init) and **writes** (`grounder note`). The agent is a thin trigger — it does not read config or compute paths.

---

## Connector config model

Two stores, split by concern:

| Store | Path | Holds | Committed? |
| --- | --- | --- | --- |
| **Home** | `~/.grounder/config.json` | `vaultRoot` (machine-local) | No |
| **Repo** | `.grounder.json` | `projectId` only | Optional (per folder) |

### Home config

```json
{
  "vaultRoot": "/Users/you/Documents/obsidian/dev"
}
```

### Repo marker

```json
{
  "version": 1,
  "projectId": "my-app"
}
```

No redundant paths in repo file. Paths derived by convention in `vault/layout.ts`, composed via `connector/vault.ts`.

### Resolution (CLI only)

```text
absoluteNotesDir = home.vaultRoot + "/10-Projects/" + repo.projectId + "/notes"
```

Env override: `GROUNDER_VAULT` replaces `home.vaultRoot` when set.

### Why split?

- **Repo** = stable project identity (portable, team-visible marker).
- **Home** = personal vault location (varies per machine).
- Expandable: vault registry, extra dirs, bridge note layer on top without changing this shape.

---

## Path conventions

Opinionated defaults — not configurable in Phase 1:

| Artifact | Path (relative to vault root) |
| --- | --- |
| Project root | `10-Projects/{projectId}/` |
| Notes | `10-Projects/{projectId}/notes/` |

`10-Projects` is a numbered-folder vault habit (Johnny Decimal–style), not an industry standard. One fixed rule in Grounder; custom `paths` block is a later escape hatch.

---

## Vault I/O — how CLI writes markdown

Vault is a normal directory. No Obsidian API in Phase 1.

| Operation | API |
| --- | --- |
| Create dirs | `node:fs/promises` → `mkdir(path, { recursive: true })` |
| Write note | `writeFile(path, body, "utf8")` |
| Avoid overwrite | `access` / `stat`; if slug exists, append `-HHmm` |
| Frontmatter | Optional string prefix in body — still plain `writeFile` (**not implemented**; raw body only) |

No npm dependencies for I/O. Obsidian app does not need to be running.

---

## Commands

| Command | Where | Purpose |
| --- | --- | --- |
| `grounder vault init [path]` | anywhere | Once per machine/vault: home config, vault scaffold, `/grounder-note` command |
| `grounder init` | project folder | Once per linked folder: write `.grounder.json` in cwd + vault `notes/` folder |
| `grounder note <text>` | linked tree | Write note to vault (walk up for `.grounder.json`) |
| `grounder path notes` | linked tree | Print resolved notes dir (debug) |

### UX pattern: hybrid (init commands only)

1. **Detect** defaults (don't ask unless missing or ambiguous).
2. **Show plan** (paths to be written).
3. **Confirm** once (`[Y/n]`).
4. **Flags** override for automation.

| Flag | Applies to | Effect |
| --- | --- | --- |
| `--yes` | init commands | Skip confirm |
| `--force` | init commands | Overwrite existing generated files |
| `--id <id>` | `init` | Override detected project id |
| `--vault <path>` | `init` | Override home vault root for this run |
| `--title <slug>` | `note` | Note filename slug (default: slugified text; timestamp if slug empty) |

### `grounder vault init [path]`

**Writes:**

- `~/.grounder/config.json`
- Vault scaffold (minimal):
  ```
  <vaultRoot>/
  └── 10-Projects/          # empty parent; projects created by `init`
  ```
- `~/.cursor/commands/grounder-note.md` — thin slash command (skip if exists unless `--force`)

**Does not write:** MCP config, rules, skills, vault registry, bridge note, other slash commands.

**Re-run:** idempotent; skip existing unless `--force`.

**Example:**

```text
$ grounder vault init ~/Documents/obsidian/dev

Vault root: ~/Documents/obsidian/dev
Will write:
  home   ~/.grounder/config.json
  vault  10-Projects/ (if missing)
  cursor ~/.cursor/commands/grounder-note.md

Proceed? [Y/n]
```

### `grounder init`

**Requires:** home config exists (or `--vault`). If missing:

```text
No vault configured. Run: grounder vault init <path>
```

**Detects:**

- Project id in **cwd** (priority): `--id` → `package.json` name in cwd → git remote slug (if cwd is inside a git repo) → folder basename
- Sanitize id: lowercase, `[a-z0-9-]` only

**Writes:**

- `.grounder.json` in **cwd** (not inferred from git root or `package.json` parents)
- `10-Projects/{projectId}/notes/` in vault (`mkdir` recursive)

**Git:** optional. When present, shown in the plan output and used as an upper bound when later commands walk up for `.grounder.json`. Not required to run `init`.

**Does not write:** `.cursor/` in repo, vault registry, bridge note, logs/plans/decisions.

**Re-run:** idempotent; skip if already linked unless `--force`.

**Example:**

```text
$ grounder init

✓ Folder:   /Users/you/dev/my-app
✓ Git repo: /Users/you/dev/my-app
✓ Vault:    ~/Documents/obsidian/dev
✓ Project:  my-app (from package.json)

Will create:
  link   .grounder.json
  vault  10-Projects/my-app/notes/

Proceed? [Y/n]
```

### `grounder note <text>`

**Requires:** a linked folder (`.grounder.json` found walking up from cwd, stopping at git root when inside a git repo) + home config.

**Does:**

1. Walk up from cwd for nearest `.grounder.json` (stop at git root if present)
2. Read home + link config
2. Resolve `notesDir` via `connector/vault.ts` (uses `vault/layout.ts`)
3. `mkdir(notesDir, { recursive: true })`
4. Pick slug (`--title` or slugified text; timestamp fallback)
5. If file exists → append `-HHmm` to slug
6. `writeFile(notesDir/{slug}.md, text)`
7. Print written path to stdout

**Example:**

```text
$ grounder note "Investigate auth middleware"

Wrote ~/Documents/obsidian/dev/10-Projects/my-app/notes/investigate-auth-middleware.md
```

### `grounder path notes`

Print resolved absolute notes directory. Useful for debugging; no writes.

---

## Cursor integration (minimal)

One artifact — a thin slash command:

| File | Role |
| --- | --- |
| `~/.cursor/commands/grounder-note.md` | User trigger → `/grounder-note`; tells agent to run `grounder note` |

**Naming:** slash commands use **`grounder-`** prefix (e.g. `/grounder-note`). Rule/skill (Phase 2+) use **`grounder-vault`**.

**No rule** — single write path, nothing to misroute.  
**No skill** — path logic lives in CLI, not agent instructions.  
**No MCP** — deferred to Phase 2 (vault read/recall).

### `/grounder-note` command template (concept)

```markdown
Save a note to the Obsidian vault for this project.

Run: `npx grounder note "<user text>"` with the text after `/grounder-note`.
Do not compute vault paths or write files yourself — the CLI handles it.
Report the CLI output path to the user.
```

### Agent runtime behavior

1. User picks `/grounder-note some text` (or types equivalent).
2. Agent runs `grounder note "some text"` in the repo workspace.
3. Agent reports the path from CLI stdout.

Agent does **not** read `~/.grounder/config.json`, compute paths, or call MCP.

### `/grounder-note` modes

- **Mode A (Phase 1):** `/grounder-note <text>` → `grounder note "<text>"`.
- **Mode B:** defer to Phase 2 (agent output as note body).

---

## Project ID detection

Priority:

1. `--id` CLI flag
2. `name` from `package.json` in the folder being linked (cwd at `init`)
3. Git remote slug when cwd is inside a git repo (last path segment, strip `.git`)
4. Basename of the linked folder

Persist chosen id in `.grounder.json` so renames/detection drift don't break the link.

**Link resolution:** `init` writes `.grounder.json` in cwd. `note` / `path notes` walk up from cwd for the nearest marker, stopping at the git root when inside a git repo (otherwise filesystem root).

---

## Architecture

```text
┌─────────────────┐   .grounder.json      ┌──────────────────────────┐
│  Project folder │   { projectId }       │  Obsidian vault          │
│  (workspace)    │ ─────────────────────▶│  10-Projects/{id}/notes/ │
└─────────────────┘                       └──────────────────────────┘
         │                                            ▲
         │  ~/.grounder/config.json { vaultRoot }     │
         │                                            │
         ▼                                            │
┌─────────────────┐   grounder note (node:fs)         │
│  Cursor agent   │ ──────────────────────────────────┘
│  /grounder-note        │   thin trigger only
└─────────────────┘
```

**Init:** developer runs CLI.  
**Runtime:** agent invokes CLI; CLI reads config + writes file.

---

## Package layout (Phase 1)

```text
packages/grounder/
├── src/
│   ├── cli.ts
│   ├── connector/
│   │   ├── home.ts            # ~/.grounder/config.json
│   │   ├── repo.ts            # .grounder.json marker
│   │   ├── vault.ts           # resolveVaultRoot, resolveNotesDir
│   │   ├── git.ts             # findGitRoot
│   │   └── project-id.ts      # detectProjectId
│   ├── vault/
│   │   ├── layout.ts          # pure 10-Projects/… paths
│   │   └── write-note.ts
│   ├── commands/
│   │   ├── vault/init.ts      # grounder vault init
│   │   ├── repo/init.ts       # grounder init
│   │   ├── note.ts
│   │   └── path/notes.ts
│   ├── cursor/
│   │   └── grounder-note.ts
│   └── util/
│       ├── fs.ts
│       ├── project-id.ts
│       ├── note-slug.ts
│       ├── prompt.ts
│       └── parse-args.ts
├── templates/
│   └── cursor/
│       └── grounder-note.md
└── test/                      # mirrors src/
    ├── connector/
    ├── vault/
    ├── commands/
    ├── helpers.ts
    └── cli.test.ts

fixtures/
├── minimal-git-repo/
└── dev/

scripts/
└── fixture-setup.mjs
```

---

## Module architecture (shipped)

```text
connector/          # repo ↔ vault wiring
  home.ts             # ~/.grounder/config.json store
  repo.ts             # .grounder.json marker store
  vault.ts            # resolveVaultRoot, resolveNotesDir (config + env aware)
  git.ts              # findGitRoot
  project-id.ts       # detectProjectId
vault/
  layout.ts           # pure 10-Projects/… path segments (no config imports)
  write-note.ts       # note file I/O
commands/             # mirrors CLI: vault/init, repo/init, note, path/notes
cursor/grounder-note.ts
util/                 # fs, project-id, note-slug, parse-args, prompt
```

Naming: `resolve*` = config/env aware; plain names in `vault/layout.ts` = pure paths.

---

## Monorepo dev sandbox (post-Phase 1)

Added for dogfooding inside the monorepo (not required for npm consumers):

| Piece | Purpose |
| --- | --- |
| `fixtures/dev/` | Workspace package; `grounder` via `workspace:*`; `init` writes `.grounder.json` here |
| `pnpm fixture:setup` | Print dev fixture next steps |
| `.gitignore` | `fixtures/dev/.grounder.json` |

Validated: `/grounder-note` → agent runs `npx grounder note` from `fixtures/dev` → note in vault.

---

## Implementation tasks

### Step 1 — Config + paths

- [x] `connector/home.ts` — `readHomeConfig()` / `writeHomeConfig()`
- [x] `connector/repo.ts` — `readRepoConfig()` / `writeRepoConfig()`
- [x] `connector/vault.ts` — `resolveNotesDir(home, repo)`
- [x] `vault/layout.ts` — pure path conventions
- [x] `GROUNDER_VAULT` env override
- [x] Tests with temp HOME (`GROUNDER_HOME`)

### Step 2 — Detect

- [x] `connector/git.ts` — `findGitRoot(cwd)`
- [x] `connector/project-id.ts` — `detectProjectId(linkRoot, override?, gitRoot?)`
- [x] `connector/repo.ts` — `findLinkedRepoRoot(cwd, gitRoot?)`
- [x] Tests with `fixtures/minimal-git-repo/`

### Step 3 — Vault write

- [x] `writeNote(notesDir, text, { title? })` — mkdir, slug, dedup, writeFile
- [x] Tests: writes file, dedup suffix on collision

### Step 4 — `vault init`

- [x] `commands/vault/init.ts` — parse `[path]`, `--yes`, `--force`
- [x] Write home config
- [x] Create `10-Projects/` in vault if missing
- [x] `cursor/grounder-note.ts` — install slash command template
- [x] Confirm prompt + `--yes` skip
- [x] Tests: temp HOME, assert files created, re-run idempotent

### Step 5 — `init`

- [x] `commands/repo/init.ts` — require home config or `--vault`
- [x] Detect git root + project id
- [x] Write `.grounder.json`
- [x] Create vault `notes/` dir
- [x] Confirm prompt + flags
- [x] Tests: init twice → no duplicate dirs; `--force` overwrites marker

### Step 6 — `note` + `path notes`

- [x] `grounder note <text>` with `--title` flag
- [x] `grounder path notes` prints resolved dir
- [x] Fail clearly when not linked
- [x] Tests: end-to-end with temp vault

### Step 7 — Polish

- [x] Update CLI help text
- [x] README quickstart: `vault init` → `init` → `/grounder-note` or `grounder note`
- [x] Run `pnpm test` (27 tests passing)

---

## Acceptance criteria

1. [x] Fresh machine: `vault init` + `init` in a test repo produces home config, repo marker, and `notes/` folder.
2. [x] Re-run `init` is safe — no errors, no clobber unless `--force`.
3. [x] `.grounder.json` contains only `version` + `projectId` (no redundant paths).
4. [x] `grounder note "foo"` writes `10-Projects/{id}/notes/*.md` and prints path.
5. [x] `/grounder-note foo` (via agent) invokes CLI; file appears in vault.
6. [x] `--yes` runs init non-interactively (scriptable).
7. [x] Slug collision appends `-HHmm`; existing note not overwritten.

---

## Shipped vs deferred (implementation notes)

| Planned | Shipped | Notes |
| --- | --- | --- |
| All CLI commands | Yes | `vault init`, `init`, `note`, `path notes` |
| `/grounder-note` template | Yes | Installed to `~/.cursor/commands/grounder-note.md` |
| Note frontmatter | No | Raw body only; add in Phase 2 or as polish |
| `status`, `doctor` | No | Explicitly out of scope |
| Monorepo dev fixture | Yes (extra) | `fixtures/dev/` + `pnpm fixture:setup` — not in original plan |

---

## Explicitly deferred (Phase 2+)

| Feature | Notes |
| --- | --- |
| MCP + vault read/recall | Add with `/grounder-task`; agent reads vault, CLI still writes |
| Cursor rule + skill | Multi-command routing and shared procedure |
| Vault `projects.json` registry | Vault-centric project discovery |
| Bridge `_project.md` | Add with `/grounder-task` |
| `logs/`, `plans/`, `decisions/` | Session lifecycle |
| Other slash commands | handoff, plan, decision |
| `status`, `doctor` | Operational tooling |
| Templates | daily-log, handoff, etc. |
| `/grounder-note` Mode B | agent output as note body |
| Note frontmatter (created, project, tags) | Raw body only in Phase 1 |
| Custom path overrides | `paths` block in repo config |
| Monorepo / multi-package | one bridge per repo root for now |

---

## Decisions (locked)

| # | Decision |
| --- | --- |
| 1 | Connector = **repo + home split** |
| 2 | Repo file = **`{ version, projectId }` only**; paths by convention in CLI |
| 3 | Default layout = **`10-Projects/{projectId}/notes/`** |
| 4 | Init = **two CLI subcommands**, hybrid UX (detect → confirm → flags) |
| 5 | Agent **does not init, read config, or compute paths** |
| 6 | Vault writes = **`grounder note`** via **`node:fs/promises`** |
| 7 | Cursor = **one thin slash command** only; no rule, no skill |
| 8 | **No MCP** in Phase 1 |
| 9 | Cursor artifacts = **user-global** (`~/.cursor/commands/`), not project `.cursor/` |
| 10 | No vault `projects.json` in Phase 1 |
| 11 | Slash command prefix **`grounder-`** — product namespace (e.g. `/grounder-note`) |

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Machine-specific paths | Home config + `GROUNDER_VAULT` env |
| Project id collision in vault | Document; `--id` override |
| Cursor sandbox blocks vault write | CLI write outside workspace may need approval — same as MCP; document |
| Agent bypasses CLI and writes directly | Slash command instructs CLI-only; single command, low misroute risk |

---

## Links

- Full plan (later phases): `.ai/plans/grounder-init-cli.md`
- Product discussion: `.ai/plans/discussions/purpose.md`
