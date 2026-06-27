# Plan: Grounder Phase 1 — Minimal project–vault connector

**Status:** Ready for implementation  
**Repo:** `/Users/andrejkolic/dev/rey/grounder`  
**Created:** 2026-06-26  
**Updated:** 2026-06-26 (CLI-first writes; drop MCP/rule/skill; **`grounder-` command prefix**)  
**Scope:** Minimal connection + `grounder note` + `/grounder-note` trigger (Cursor)  
**Supersedes for v1:** `.ai/plans/grounder-init-cli.md` (full plan remains reference for later phases)

## How to run (new chat)

```text
Implement Grounder Phase 1 per .ai/plans/grounder-phase-1-minimal-connector.md.
```

---

## Goal

Connect a git repo to a personal Obsidian vault so a **Cursor agent** can save a note to the vault via the **Grounder CLI**.

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
| **Repo** | `.grounder.json` | `projectId` only | Yes |

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

No redundant paths in repo file. Paths derived by convention in CLI code (`paths.ts`).

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
| Frontmatter | Optional string prefix in body — still plain `writeFile` |

No npm dependencies for I/O. Obsidian app does not need to be running.

---

## Commands

| Command | Where | Purpose |
| --- | --- | --- |
| `grounder vault init [path]` | anywhere | Once per machine/vault: home config, vault scaffold, `/grounder-note` command |
| `grounder init` | repo root | Once per repo: repo marker + vault `notes/` folder |
| `grounder note <text>` | repo root | Write note to vault (CLI owns path resolution + I/O) |
| `grounder path notes` | repo root | Print resolved notes dir (debug) |

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
| `--title <slug>` | `note` | Note filename slug (default: timestamp-based) |

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

- Git repo root (fail if not in git repo)
- Project id (priority): `--id` → `package.json` name → git remote slug → repo basename
- Sanitize id: lowercase, `[a-z0-9-]` only

**Writes:**

- `.grounder.json` in repo root
- `10-Projects/{projectId}/notes/` in vault (`mkdir` recursive)

**Does not write:** `.cursor/` in repo, vault registry, bridge note, logs/plans/decisions.

**Re-run:** idempotent; skip if already linked unless `--force`.

**Example:**

```text
$ grounder init

✓ Git repo: /Users/you/dev/my-app
✓ Vault:    ~/Documents/obsidian/dev
✓ Project:  my-app (from package.json)

Will create:
  repo   .grounder.json
  vault  10-Projects/my-app/notes/

Proceed? [Y/n]
```

### `grounder note <text>`

**Requires:** linked repo (`.grounder.json` + home config).

**Does:**

1. Read home + repo config
2. Resolve `notesDir` via `paths.ts`
3. `mkdir(notesDir, { recursive: true })`
4. Pick slug (`--title` or timestamp)
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

Run: `grounder note "<user text>"` with the text after `/grounder-note`.
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
2. `name` from `package.json`
3. Git remote slug (last path segment, strip `.git`)
4. Basename of repo root

Persist chosen id in `.grounder.json` so renames/detection drift don't break the link.

---

## Architecture

```text
┌─────────────────┐   .grounder.json      ┌──────────────────────────┐
│  Git repo       │   { projectId }       │  Obsidian vault          │
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
│   ├── config.ts              # read/write home + repo config
│   ├── detect.ts              # git root, project id
│   ├── paths.ts               # convention: projectDir, notesDir
│   ├── vault/
│   │   └── write-note.ts      # mkdir + writeFile + slug dedup
│   ├── commands/
│   │   ├── vault-init.ts
│   │   ├── init.ts
│   │   ├── note.ts
│   │   └── path.ts
│   └── cursor/
│       └── install-command.ts # copy grounder-note.md to ~/.cursor/commands/
├── templates/
│   └── cursor/
│       └── grounder-note.md
└── test/
    ├── config.test.ts
    ├── detect.test.ts
    ├── paths.test.ts
    ├── write-note.test.ts
    ├── vault-init.test.ts
    ├── init.test.ts
    └── note.test.ts
```

---

## Implementation tasks

### Step 1 — Config + paths

- [ ] `readHomeConfig()` / `writeHomeConfig()` → `~/.grounder/config.json`
- [ ] `readRepoConfig()` / `writeRepoConfig()` → `.grounder.json`
- [ ] `resolveNotesDir(home, repo)` → absolute path
- [ ] `GROUNDER_VAULT` env override
- [ ] Tests with temp HOME and temp repo

### Step 2 — Detect

- [ ] `findGitRoot(cwd)`
- [ ] `detectProjectId(cwd, override?)` with priority chain + sanitize
- [ ] Tests with `fixtures/minimal-git-repo/`

### Step 3 — Vault write

- [ ] `writeNote(notesDir, text, { title? })` — mkdir, slug, dedup, writeFile
- [ ] Tests: writes file, dedup suffix on collision

### Step 4 — `vault init`

- [ ] Parse `[path]`, `--yes`, `--force`
- [ ] Write home config
- [ ] Create `10-Projects/` in vault if missing
- [ ] Install `grounder-note.md` command template
- [ ] Confirm prompt + `--yes` skip
- [ ] Tests: temp HOME, assert files created, re-run idempotent

### Step 5 — `init`

- [ ] Require home config or `--vault`
- [ ] Detect git root + project id
- [ ] Write `.grounder.json`
- [ ] Create vault `notes/` dir
- [ ] Confirm prompt + flags
- [ ] Tests: init twice → no duplicate dirs; `--force` overwrites marker

### Step 6 — `note` + `path notes`

- [ ] `grounder note <text>` with `--title` flag
- [ ] `grounder path notes` prints resolved dir
- [ ] Fail clearly when not linked
- [ ] Tests: end-to-end with temp vault

### Step 7 — Polish

- [ ] Update CLI help text
- [ ] README quickstart: `vault init` → `init` → `/grounder-note` or `grounder note`
- [ ] Run `pnpm test`

---

## Acceptance criteria

1. Fresh machine: `vault init` + `init` in a test repo produces home config, repo marker, and `notes/` folder.
2. Re-run `init` is safe — no errors, no clobber unless `--force`.
3. `.grounder.json` contains only `version` + `projectId` (no redundant paths).
4. `grounder note "foo"` writes `10-Projects/{id}/notes/*.md` and prints path.
5. `/grounder-note foo` (via agent) invokes CLI; file appears in vault.
6. `--yes` runs init non-interactively (scriptable).
7. Slug collision appends `-HHmm`; existing note not overwritten.

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
