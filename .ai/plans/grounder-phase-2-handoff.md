# Grounder Phase 2 — Session handoff (product idea)

**Status:** product idea + implementation steps (details TBD)  
**Created:** 2026-07-17  
**Updated:** 2026-07-17 (implementation steps)  
**Basis:** `.ai/plans/grounder-product-idea.md`, `.ai/discussions/purpose.md`, design discussion 2026-07-17  
**Builds on:** Phase 1 slim connector (`grounder note`, marker + home config + convention)

> Product decisions above. Implementation **steps** below. Per-step details still TBD.

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

## Implementation steps

Order: **write path before recall**; within each side, **CLI before agent glue**. Details per step TBD.

| Step | Focus | Deliverable |
| --- | --- | --- |
| **1** | Vault write core | `logs/` path resolution + write handoff file (timestamp, optional title, no clobber, lean template) |
| **2** | Handoff CLI | `grounder handoff` — agent-supplied body → vault file; print path |
| **3** | Handoff tests | Unit + CLI smoke (mirror `note`) |
| **4** | Handoff agent glue | `/grounder-task-handoff` slash command (summarize → CLI); install via adapters |
| **5** | Recall CLI | List/resolve recent handoffs (e.g. newest or last N paths) — no content dump required |
| **6** | Recall tests | Unit + CLI smoke for list/resolve |
| **7** | Recall agent glue | `/grounder-task` — run recall CLI → read newest log + `AGENTS.md` |

### Rules for the sequence

- Do not start agent templates until the matching CLI works and is tested.
- Skill/router rule only if slash commands alone are insufficient.
- Bridge note stays out of this phase.

### Next

Fill in implementation details per step (API surface, file layout, acceptance criteria), starting with step 1.
