# Grounder — product idea

**Status:** idea only (no implementation plan)  
**Created:** 2026-07-17  
**Basis:** `.ai/plans/grounder-init-cli.md` (original vision), filtered by `.ai/discussions/purpose.md` and `.ai/analysis-1.md`, on top of the slim Phase 1 connector.

> Implementation details are out of scope here. See Phase 1 plan + `AGENTS.md` for what already shipped.

---

## One-line positioning

> **Grounder: governed session memory for coding agents — personal vault continuity without polluting the repo or the notes.**

Init gets you installed. The **session loop** gets you kept.

---

## Foundation (already true)

Slim connector — do not grow this into a second config system:

| Piece | Role |
| --- | --- |
| `~/.grounder/config.json` | Machine-local vault root |
| `.grounder.json` | `{ version, projectId }` only |
| Convention | `10-Projects/{projectId}/{notes,logs,plans,decisions}/` |
| CLI | Resolves paths and writes; agent does not invent paths |

**No `projects.json` required** for the product loop. Path resolution is marker + home + convention.

**No fat configs.** Bridge is recall content, not a path store. Repo marker stays identity-only.

---

## What makes Grounder useful (feature map)

### 1. Session continuity — core value

The loop competitors under-deliver on:

| Feature | Why it matters |
| --- | --- |
| **Start task** — load minimal project context | Cold starts waste tokens and miss prior work |
| **Continue task** — prioritize latest handoff | Resume without re-discovering state |
| **End task / handoff** — structured session close | Continuity for the next session |
| **Dated logs** under the project | Chronological trail without dumping chat |
| **Branch-aware handoffs** (later) | Avoid mixing contexts across branches |

This is the product. Everything else supports this loop.

```text
/task → work → /task-handoff → next /task
```

---

### 2. Write governance — moat

| Feature | Why it matters |
| --- | --- |
| **Slash commands only** for vault writes | Stops free-text “save this” chaos |
| **One command → one folder** | notes / logs / plans / decisions stay clean |
| **No clobber** — always new files (or explicit force) | Protects user-edited vault content |
| **Chat ≠ vault** unless an explicit write command | Prevents bloated “memory” dumps |
| **Repo docs win** — `AGENTS.md` / repo plans override vault for *how to build* | Personal vault = continuity, not team truth |

Positioning: *agent memory with guardrails*, not another second brain.

---

### 3. Precision recall — bridge as router

| Feature | Why it matters |
| --- | --- |
| **Project bridge note** — short map, not a dump | Session start reads one router file |
| **Links to repo truth** (`AGENTS.md`, `.ai/plans/`, docs) | Don’t duplicate; point |
| **Links to vault folders** (logs, notes, plans, decisions) | Agent knows where to look/write |
| **Recall budget** — cap files at session start | Fast, predictable context |
| **Optional refresh** — update bridge tables from repo scan | Stays accurate without hand-editing |

Bridge is **content for recall**, not path configuration. Paths stay convention-derived.

---

### 4. Personal vs repo split — architecture

| Feature | Why it matters |
| --- | --- |
| **Repo marker only** (project id) | Portable identity; no personal paths in git |
| **Personal vault** for logs / notes / plans / decisions | Memory stays out of the repo |
| **Team truth in git** | Shared conventions stay reviewable |
| **Draft in vault → promote to repo** (later) | Personal thinking → team artifact when ready |

Clear answer to “where should the agent write?”

---

### 5. Wiring / setup — necessary, not the product

| Feature | Why it matters |
| --- | --- |
| **Vault init once** — home config + vault layout + agent glue | One-time tax |
| **Project init** — marker + project folders by convention | Per-repo link |
| **Idempotent re-run** | Safe to fix / upgrade |
| **Path helpers** | Agents never invent paths |
| **CLI write path** for notes / handoffs | Reliable even without MCP |

Keep this thin. Init is table stakes; session loop is retention.

---

### 6. Agent integration — pluggable glue

| Feature | Why it matters |
| --- | --- |
| **Thin slash commands** per action | User-triggered, discoverable |
| **Router rule** — command → folder | Enforces governance |
| **Shared skill / procedure** — resolve project, read bridge, write via CLI/MCP | Consistency across chats |
| **Multi-agent adapters** (Cursor, Claude, …) | Same vault, different install targets |
| **MCP for vault read** when useful | Transport stays delegated |

Vault layout stays agent-agnostic; only install targets differ.

---

### 7. Capture types — beyond handoff

| Feature | Why it matters |
| --- | --- |
| **Notes** (verbatim or agent-output mode) | Scratch / distilled thoughts |
| **Plans** | Mid-size design without polluting repo |
| **Decisions** | Lightweight ADRs in vault |
| **Templates** for each type | Consistent structure agents can fill |

Same governance pattern: one command, one folder, template-shaped body.

---

### 8. Operational trust — keep users

| Feature | Why it matters |
| --- | --- |
| **Status** — linked? which project? which vault paths? | Debug “why isn’t memory working?” |
| **Doctor** — vault reachable, commands installed, MCP ok | Support you don’t give manually |
| **Multi-project correctness** — always resolve *this* workspace’s project | Wrong-project context is a silent killer |

Useful; secondary to the session loop. No registry required if resolution is marker + convention.

---

## Competitive priority order

```text
1. Session loop          task → work → handoff → recall
2. Write governance      commands, folders, no clobber
3. Bridge as router      minimal context + repo links
4. Thin wiring           vault init + project init + path CLI
5. Capture types         note / plan / decision
6. Ops                   status + doctor
7. Multi-agent breadth   more adapters / hooks later
```

Ship for layers 1–4 first. Layer 5 fills out the command surface. Layers 6–7 expand trust and reach.

---

## Explicit non-goals (for this idea)

- Fat `projects.json` / path registry as source of truth
- Fat `.grounder.json` (vaultRoot, bridge paths, duplicated dirs)
- Building a custom MCP server, RAG, or embeddings
- Obsidian-in-app agents / plugins
- Large slash-command surface (dozens of commands)
- Sync / hosting service

---

## Relationship to other docs

| Doc | Role after this |
| --- | --- |
| `grounder-product-idea.md` (this) | Product idea — what and why |
| `grounder-phase-1-minimal-connector.md` | What shipped (connector + note) |
| `pluggable.md` | Agent adapter architecture (shipped) |
| `purpose.md` | Market / value thesis (source for priorities here) |
| `analysis-1.md` | Earlier snapshot; priorities superseded by this doc where they conflict |
| `grounder-init-cli.md` | Historical full vision — reference only, not the active roadmap |

---

## Next

Discuss and document an **implementation plan** separately (phases, commands, templates, acceptance criteria) when ready to build the session loop on the slim foundation.
