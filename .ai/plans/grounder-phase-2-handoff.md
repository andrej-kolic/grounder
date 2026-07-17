# Grounder Phase 2 — Session handoff (product idea)

**Status:** implementation plan  
**Created:** 2026-07-17  
**Updated:** 2026-07-17 (implementation plan)  
**Basis:** `.ai/plans/grounder-product-idea.md`, `.ai/discussions/purpose.md`, design discussion 2026-07-17  
**Builds on:** Phase 1 slim connector (`grounder note`, marker + home config + convention)

> Product decisions above. Implementation plan below.

---

## One-line goal

> **Governed session checkpoints in the personal vault — structured handoffs, not chat dumps — so the next session does not start cold.**

Phase 1 wired the vault. Phase 2 makes the **session loop** real.

```text
/grounder-task → work → /grounder-task-handoff → next /grounder-task
```

---

## Core insight

The chat stays in the chat. Obsidian gets a **structured checkpoint**.

| Lives in chat (ephemeral) | Lives in vault (`logs/`) |
| --- | --- |
| Full conversation, tool calls, false starts | Done / next / blockers / decisions / key files |
| Agent working memory | Continuity for the next cold start |

**Chat ≠ vault** unless an explicit write command. Handoff is that command for session close.

---

## What Phase 2 is (and is not)

### Is

| Piece | Role |
| --- | --- |
| **`/grounder-task-handoff`** | Primary product — one new log file per close |
| **`/grounder-task`** | Read-only hydrate — newest handoff + repo truth (`AGENTS.md`) |
| **CLI write path** | Same split as `note`: agent summarizes, CLI writes |
| **Lean template** | Fixed sections agents can fill consistently |

### Is not (this phase)

| Deferred | Why |
| --- | --- |
| **Bridge note** (`_project.md`) | Identity, latest log, and `AGENTS.md` are already derivable from folder + convention + skill |
| **Fat recall maps** | Folder/command tables belong in skill/rule, not per-project files |
| **Branch-aware handoffs** | Later; frontmatter `branch:` is enough to start |
| **Auto SessionEnd hooks** | Explicit slash discipline first; hooks later if forgetfulness hurts |
| **Rolling single `handoff.md`** | Conflicts with no-clobber; newest-file wins instead |
| **Native IDE dropdown of logs** | Cursor slash commands are static; list via CLI + agent if needed |

---

## File model: one file per handoff

Each `/grounder-task-handoff` creates a **new** file under the project logs folder:

```text
10-Projects/{projectId}/logs/
  2026-07-17T2030.md
  2026-07-17T2030-session-loop.md   # optional title slug
```

| Rule | Decision |
| --- | --- |
| Naming | Timestamp prefix (sortable); optional `--title` / name slug appended |
| Multiple handoffs in one chat | Allowed — each is a new checkpoint; **newest wins** on resume |
| Overwrite | Never — same no-clobber posture as notes |
| “Latest” | Sort `logs/*` by filename; no bridge pointer required |

Daily append-to-one-file and single rolling `handoff.md` are rejected for v1 continuity (journal vs checkpoint; overwrite vs governance).

---

## Responsibilities: agent vs CLI

Same pattern as `grounder note`:

| Who | Job |
| --- | --- |
| **Agent** | Summarize the session into the handoff template (not the transcript) |
| **CLI** | Resolve project → logs dir, wrap frontmatter, write new file, print path |
| **Slash command** | Thin trigger: fill template → run CLI — do not invent vault paths |

`/grounder-task` is **read-only**: resolve project → read newest log (optionally list recent) → read `AGENTS.md` → work. No vault write.

---

## Handoff file structure (lean)

Successful peers converge on short checkpoints (done / next / blockers), not kitchen-sink docs. Grounder default:

```markdown
---
project: <projectId>
branch: <git branch if known>
created: <ISO timestamp>
title: <optional slug>
---

# Handoff: <title or short label>

## Done
- …

## Next
1. …   # ordered; most important section for resume
2. …

## Blockers
- None | …

## Decisions
- …    # including rejected alternatives / pitfalls

## Files
- path/to/relevant.ts
```

### Content rules

- **Next is mandatory and ordered** — if only one section is read, this is it
- **Short** — roughly half a screen to one screen; not a transcript
- **Concrete paths** — few key files, not exhaustive diffs
- **Empty sections OK** — `Blockers: none` beats omission
- **No chat dump** — no tool traces, no full conversation

Fat sections (architecture overview, env state, long TOCs) are out of the default template. Optional later for rare deep handoffs; daily loop stays lean.

---

## `/grounder-task` (recall)

Minimal hydrate — no bridge required:

```text
resolve project (marker + home + convention)
  → newest file in logs/   (+ optional list of recent N for agent choice)
  → AGENTS.md (repo truth)
  → work
```

Optional session name / index as a free-text slash arg is fine. A native Cursor dropdown of the last five logs is **not** available from static slash commands; a CLI `list` helper can feed the agent instead.

---

## Positioning vs peers

| Peer pattern | Grounder choice |
| --- | --- |
| Rolling `handoff.md` (markdown-memory) | One immutable file per close; newest = current |
| Auto SessionEnd hooks | Explicit `/grounder-task-handoff` first |
| Fat session-handoff templates | Lean five-section body |
| In-repo memory (`ai/`) | Personal vault `logs/` only |
| Bridge/passport as load-bearing | Deferred; convention + newest log |

Differentiation stays: **governed writes** (slash → folder → no clobber) + **personal vault continuity**.

---

## Success criteria (product-level)

A developer feels Phase 2 worked when:

1. Ending a session with handoff takes one command and produces a readable checkpoint in Obsidian  
2. Opening a new chat and starting a task recovers **what’s next** without re-discovering state  
3. The vault does not fill with chat dumps or overwritten user files  
4. Handoff quality is consistent enough that day-2 resume is trustworthy

---

## Relationship to other docs

| Doc | Role |
| --- | --- |
| `grounder-product-idea.md` | Broader product map — session loop is #1 |
| `grounder-phase-1-minimal-connector.md` | What shipped (connector + note) |
| `grounder-phase-2-handoff.md` (this) | Product idea for handoff / session continuity |
| `grounder-init-cli.md` | Historical full vision — reference only where it does not conflict |
| `purpose.md` | Market thesis (handoff quality, recall budget, governance) |

---

## Implementation plan

Order: **write path before recall**; within each side, **CLI before agent glue**.

### Locked decisions

| # | Decision |
| --- | --- |
| 1 | **One file per handoff** — never overwrite; newest filename wins on resume |
| 2 | **Positional body** — same UX as `note`: agent supplies markdown body; no `--done` / `--next` flags |
| 3 | **CLI prepends frontmatter** — `project`, `branch`, `created`, optional `title`; body is agent content |
| 4 | **Filename** — reuse note slug rules: `YYYY-MM-DD-HHmm[-title].md`; second-precision + numeric suffix on collision |
| 5 | **`logs/` on init** — create alongside `notes/` in `grounder init` |
| 6 | **Branch** — best-effort from git at write time; omit if not in a git repo |
| 7 | **Recall CLI** — list paths only (`handoff list`, `path logs`); agent reads file contents |
| 8 | **Empty logs** — `/grounder-task` proceeds with `AGENTS.md` only; report no handoffs yet |
| 9 | **Bridge** — out of scope for this phase |
| 10 | **Agent glue last** — slash commands only; no rule/skill unless slash alone proves insufficient |

### Package additions (mirror Phase 1)

```text
packages/grounder/src/
  vault/
    layout.ts           # + logsDir()
    write-handoff.ts    # mkdir, slug, frontmatter, writeFile
    list-handoffs.ts    # sort logs/*.md, limit N
  connector/
    vault.ts            # + resolveLogsDir()
    git.ts              # + currentBranch(gitRoot) — best-effort
  commands/
    handoff.ts          # grounder handoff <text>
    handoff/list.ts     # grounder handoff list [--limit N]
    path/logs.ts        # grounder path logs
templates/
  agents/
    cursor/commands/grounder-task-handoff.md
    cursor/commands/grounder-task.md
    claude/commands/grounder-task-handoff.md
    claude/commands/grounder-task.md
  vault/session-handoff.md   # reference template for slash commands (not auto-filled by CLI)
test/
  vault/write-handoff.test.ts
  vault/list-handoffs.test.ts
  commands/handoff.test.ts
  commands/handoff/list.test.ts
  commands/path/logs.test.ts
```

Reuse `timestampedBasename` / collision logic from `write-note.ts` (extract shared basename helper or call same slug functions).

### CLI surface

```text
grounder handoff <text>       Write handoff to vault logs/
  --title <slug>              Optional filename slug + frontmatter title

grounder handoff list         Print recent handoff paths (newest first)
  --limit <n>                 Default 5

grounder path logs            Print resolved logs directory
```

**Handoff input:** agent builds the markdown body (H1 + `## Done` / `## Next` / …) per slash-command instructions; passes it as positional text to `grounder handoff`. CLI does not validate section presence in v1 (enforce via slash prompt only).

**Handoff output file:**

```markdown
---
project: <projectId>
branch: <branch or omitted>
created: <ISO-8601>
title: <slug or omitted>
---

<body from agent>
```

**List output:** one absolute path per line, newest first. Exit 0 with no output when `logs/` is empty.

---

### Step 1 — Vault write core

- [x] `vault/layout.ts` — `logsDir(vaultRoot, projectId)`
- [x] `connector/vault.ts` — `resolveLogsDir(home, repo, vaultOverride?)`
- [x] `connector/git.ts` — `currentBranch(gitRoot)` (e.g. `git rev-parse --abbrev-ref HEAD`; return `undefined` on failure)
- [x] `vault/write-handoff.ts` — `writeHandoff(logsDir, body, { title?, projectId, branch?, now? })`
  - mkdir `logsDir`
  - basename via same rules as notes
  - prepend YAML frontmatter + body
  - return written path
- [x] Tests: frontmatter fields, slug/collision, mkdir when missing

### Step 2 — Handoff CLI

- [ ] `commands/handoff.ts` — `runHandoff(argv)` / `runHandoffWithOptions`
  - same link resolution as `note` (home → linked repo → logs dir)
  - `--title` flag
  - stdout: `Wrote <path>`
- [ ] `cli.ts` — route `handoff` subcommand; update help text
- [ ] `commands/repo/init.ts` — also `mkdir(logsDir)`; update “Will create” output

### Step 3 — Handoff tests

- [ ] `test/vault/write-handoff.test.ts` — unit tests for write + collision
- [ ] `test/commands/handoff.test.ts` — end-to-end + CLI smoke (mirror `note.test.ts`)
- [ ] `pnpm test` green

### Step 4 — Handoff agent glue

- [ ] `templates/vault/session-handoff.md` — lean section reference (Done / Next / Blockers / Decisions / Files)
- [ ] `templates/agents/cursor/commands/grounder-task-handoff.md`
  - summarize session into template (not transcript)
  - run `npx grounder handoff "<body>"` with optional `--title`
  - do not compute vault paths or write files directly
- [ ] `templates/agents/claude/commands/grounder-task-handoff.md` — same instructions
- [ ] Extend `agents/cursor.ts` + `agents/claude.ts` — install new command(s) on `vault init` (skip if exists unless `--force`)
- [ ] Tests: adapter install copies new templates

### Step 5 — Recall CLI

- [ ] `vault/list-handoffs.ts` — `listHandoffs(logsDir, { limit? })` → sorted `.md` paths, desc
- [ ] `commands/handoff/list.ts` — `runHandoffList(argv)`; `--limit` default 5
- [ ] `commands/path/logs.ts` — `runPathLogs(argv)` (mirror `path notes`)
- [ ] `cli.ts` — route `handoff list` and `path logs`; update help

### Step 6 — Recall tests

- [ ] `test/vault/list-handoffs.test.ts` — sort order, limit, empty dir
- [ ] `test/commands/handoff/list.test.ts` + `test/commands/path/logs.test.ts`
- [ ] `pnpm test` green

### Step 7 — Recall agent glue

- [ ] `templates/agents/cursor/commands/grounder-task.md`
  - run `grounder handoff list --limit 5` (or `path logs` + read newest)
  - read newest handoff file + repo `AGENTS.md`
  - if no handoffs: say so, read `AGENTS.md` only
  - read-only — no vault writes
- [ ] `templates/agents/claude/commands/grounder-task.md` — same
- [ ] Extend adapters to install recall command(s)
- [ ] Tests: adapter install

### Step 8 — Polish

- [ ] README: handoff quickstart (`handoff` → `/grounder-task-handoff` → `/grounder-task`)
- [ ] `AGENTS.md` — document new modules if layout changed materially
- [ ] Dogfood in `fixtures/dev/`

---

## Acceptance criteria

1. `grounder init` creates `10-Projects/{id}/logs/` alongside `notes/`.
2. `grounder handoff "<body>"` writes a new `.md` in `logs/` with frontmatter; prints path; never overwrites.
3. Second handoff in the same minute gets a distinct filename (second precision or suffix).
4. `grounder handoff list` prints newest paths first; empty when no logs.
5. `grounder path logs` prints resolved logs directory.
6. `/grounder-task-handoff` (via agent) invokes CLI; file appears in vault with expected sections.
7. `/grounder-task` reads newest handoff + `AGENTS.md`; works when `logs/` is empty.
8. Re-run `init` remains safe — no log deletion.

---

## Explicitly deferred (post Phase 2)

| Feature | Notes |
| --- | --- |
| Bridge `_project.md` | Convention + newest log is enough for now |
| `/grounder-task-continue` | Same as task with “prioritize handoff” emphasis — add if task alone is insufficient |
| CLI body validation | Warn if `## Next` missing |
| Section flags (`--done`, `--next`) | Only if positional body quality fails in practice |
| Branch-aware filenames | Frontmatter `branch:` first; filename suffix later |
| SessionEnd hooks | Explicit slash discipline first |
| MCP vault read | Agent reads files directly for now |
| Cursor rule + skill | Slash commands only |
| `status`, `doctor` | Ops tooling |
| `plans/`, `decisions/` commands | Later capture types |

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Agent skips required sections | Slash template is explicit; optional CLI validation later |
| Long body breaks shell quoting | Agent uses heredoc or escaped string; document in slash command |
| Branch detection fails outside git | Omit `branch` in frontmatter |
| Adapter install only on `vault init` | Document re-run `vault init --force` or manual copy for existing users |
| Handoff quality still depends on agent | Template + “Next is mandatory” in slash prompt |

---

## How to run (new chat)

```text
Implement Grounder Phase 2 per .ai/plans/grounder-phase-2-handoff.md.
Start with Step 1 (vault write core). CLI before agent glue.
Run pnpm test after each step.
```
