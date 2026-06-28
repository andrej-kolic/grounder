Read [](file:///Users/andrejkolic/dev/rey/grounder/.ai/plans/grounder-phase-1-minimal-connector.md#1-1), lines 1 to 100

Read [](file:///Users/andrejkolic/dev/rey/grounder/.ai/plans/grounder-init-cli.md#1-1), lines 1 to 100

Read [](file:///Users/andrejkolic/dev/rey/grounder/.ai/discussions/purpose.md#1-1), lines 1 to 100

Read [](file:///Users/andrejkolic/dev/rey/grounder/.ai/plans/grounder-init-cli.md#100-100), lines 100 to 200

Read [](file:///Users/andrejkolic/dev/rey/grounder/.ai/plans/grounder-init-cli.md#200-200), lines 200 to 300

---

## What Grounder is

A CLI that automates connecting a git project to a personal Obsidian vault so AI agents (Cursor-first) get **persistent structured memory** across sessions — without committing personal docs to the repo.

The core insight: agent memory (logs, notes, plans, decisions) is personal, not project-owned. The repo gets a tiny pointer (`.grounder.json`), the vault gets the real content.

**Two-step setup:**
1. `grounder vault init` — once per machine: scaffold vault structure + install Cursor artifacts (MCP config, slash commands, rule, skill)
2. `grounder init` — once per project: register in vault registry, create project folders, write bridge note

**Daily driver:** `/grounder-*` slash commands in Cursor that write to specific vault folders via the MCP layer (`@bitbonsai/mcpvault` for I/O)

**Phase 1 done:** connector config (home + repo stores), both init commands, `grounder note`, `/grounder-note` slash command.

---

## What's still unbuilt (Phase 2+)

| Priority | What |
|---|---|
| High | Full vault scaffold in `grounder vault init` (templates, `00-AI/`, `90-Inbox/`) |
| High | Cursor artifact install (MCP config, slash commands, rule, skill) |
| High | Bridge note (`_project.md`) + `projects.json` registry in `grounder init` |
| Medium | `grounder status` — debug link state |
| Medium | Session lifecycle commands (`/grounder-task`, `/grounder-task-handoff`) |
| Low | `grounder doctor`, `grounder log`, `grounder decision` |

---

## Observations and open questions

**Where I think the real value is:**

The killer feature isn't `grounder note` — it's the **full vault install**: one command that wires MCP, creates slash commands, installs the router rule and skill. None of the competitors do this end-to-end for Cursor. That's the onboarding story.

**Tension worth resolving:**

The plan says "Cursor-first" but also "agent-agnostic vault". These aren't contradictory — the vault structure *is* agent-agnostic, while the Cursor artifacts are the first integration layer. Worth making this explicit: vault layout is the stable core, Cursor support is a pluggable target (and "VS Code + Copilot" could be another).

**Session lifecycle is the daily driver:**

`/grounder-task` (load context) → work → `/grounder-task-handoff` (write log) is the loop users will actually use daily. Without it, the tool is a one-time setup step, not something you rely on every session. This should be prioritized even before `status`/`doctor`.

**Risks:**

- Cursor-specific paths (`~/.cursor/`) — changes to Cursor's config format would break the install. Worth abstracting early.
- `@bitbonsai/mcpvault` dependency — you're delegating transport, which is correct, but worth having a fallback documented.
- The Johnny Decimal folder naming (`10-Projects/`, `00-AI/`) is opinionated. Some users will want to customize. A `paths` escape hatch in config (already mentioned in the plan as a later addition) keeps the defaults but doesn't lock people out.

**What would make it stand out vs. mnemex/markdown-memory:**

The Cursor integration completeness (not just vault wiring but also automatic agent procedure install), the clean dual-mode `/grounder-note`, and the strict write governance (one command = one folder, no leakage). The competitors are either Claude-centric or require manual Cursor setup on top.

---

Next — the session lifecycle design, the vault init completeness, the agent-agnostic angle, or something else?
