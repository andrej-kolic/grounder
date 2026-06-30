## Agent Plugin Architecture for Grounder

### What the ecosystem reveals

Each major agent has settled on a specific set of files/directories:

| Agent | Global artifacts | Project artifacts |
|---|---|---|
| **Cursor** | `~/.cursor/commands/*.md`, `~/.cursor/rules/*.mdc`, `~/.cursor/skills/*/SKILL.md` | AGENTS.md, `.cursor/rules/` |
| **Claude Code** | `~/.claude/commands/*.md`, `~/.claude/CLAUDE.md` | `CLAUDE.md`, `.claude/rules/` |
| **GitHub Copilot** | none (IDE-managed) | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` |
| **All** | — | AGENTS.md (emerging cross-agent standard) |

The vault structure (`10-Projects/`, `notes/`, `logs/`) is **100% agent-agnostic**. The only agent-specific part is *where to install the glue artifacts* that tell the agent how to use the vault.

---

### What Grounder currently does (the problem)

```
commands/vault/init.ts
  └─ calls installGrounderNoteCommand()   ← hardcoded Cursor call

cursor/grounder-note.ts                   ← one artifact, one agent
  └─ installs ~/.cursor/commands/grounder-note.md

templates/cursor/                         ← agent-specific in ad-hoc location
```

This works for one agent. Adding Claude Code means duplicating the pattern without a seam.

---

### Three architecture options

#### Option A: Flat modules, no interface (current pattern extended)

Add `claude/grounder-note.ts`, `copilot/grounder.ts` alongside `cursor/`. `vault/init.ts` calls each conditionally with `if (hasCursor) ... if (hasClaude) ...`.

**Pros**: no abstraction overhead, easy to understand.  
**Cons**: `vault/init.ts` accretes conditional branches; no contract between agents; templates stay scattered.

#### Option B: Agent adapter interface + registry (recommended)

A thin `AgentAdapter` interface per agent. A registry resolves which adapters to run (auto-detect or explicit). `vault/init.ts` iterates adapters — no agent-specific code there.

**Pros**: clean seam, templates colocated per agent, detection + install per agent isolated, easy to add new agents.  
**Cons**: small upfront cost (~3 files).

#### Option C: Separate npm packages (`@grounder/agent-cursor`)

Each agent is a publishable plugin. Used by large ecosystems (ESLint, Prettier).  
**Too much**: wrong scale for 3-4 built-in agents. Defer if/when community adapters emerge.

---

### Recommended: Option B (adapter registry)

The shape that fits Grounder's existing style:

#### Directory structure

```
src/
  agents/
    types.ts          ← AgentAdapter interface + result types
    cursor.ts         ← Cursor adapter (absorbs cursor/)
    claude.ts         ← Claude Code adapter (stub)
    index.ts          ← registry, resolveAgents(), detectAgents()
  cursor/             ← keep during migration, or delete once absorbed
  commands/
    vault/init.ts     ← iterates agent registry, no agent names hardcoded
  connector/          ← unchanged
  vault/              ← unchanged

templates/
  agents/
    cursor/
      commands/grounder-note.md   ← already exists, just moves
    claude/
      commands/grounder-note.md   ← new
  vault/              ← unchanged
```

#### Interface (minimal, no over-engineering)

```ts
// src/agents/types.ts

export interface AgentInstallOptions {
  force?: boolean;
  homeDir?: string;
}

export type ArtifactStatus = "created" | "skipped" | "overwritten";

export interface AgentInstallResult {
  artifacts: Record<string, ArtifactStatus>;  // path → status
}

export interface AgentAdapter {
  readonly id: string;             // 'cursor' | 'claude' | 'copilot'
  readonly name: string;           // display name for output
  isInstalled(): Promise<boolean>; // detect: does ~/.cursor exist?
  install(opts: AgentInstallOptions): Promise<AgentInstallResult>;
}
```

#### Registry + detection

```ts
// src/agents/index.ts

import { cursor } from './cursor.js';
import { claude } from './claude.js';

const ALL_ADAPTERS: AgentAdapter[] = [cursor, claude];

/** Returns adapters to use: explicit list OR auto-detected. */
export async function resolveAgents(ids?: string[]): Promise<AgentAdapter[]> {
  if (ids && ids.length > 0) {
    return ALL_ADAPTERS.filter(a => ids.includes(a.id));
  }
  const detected = await Promise.all(
    ALL_ADAPTERS.map(async a => ({ adapter: a, ok: await a.isInstalled() }))
  );
  return detected.filter(d => d.ok).map(d => d.adapter);
}
```

#### How `vault/init.ts` changes

```ts
// Before (agent-specific):
const result = await installGrounderNoteCommand({ force, homeDir });
process.stdout.write(`  cursor ${commandPath} — ${result}\n`);

// After (agent-agnostic):
const agents = await resolveAgents(options.agents);  // from flag or auto-detect
for (const agent of agents) {
  const result = await agent.install({ force, homeDir });
  for (const [path, status] of Object.entries(result.artifacts)) {
    process.stdout.write(`  ${agent.id.padEnd(8)} ${path} — ${status}\n`);
  }
}
```

#### CLI flag

```bash
grounder vault init ~/vault              # auto-detect installed agents
grounder vault init ~/vault --agent=cursor --agent=claude   # explicit
```

No flag: auto-detect. This is the right default — if you have Cursor installed, you want its artifacts.

#### Detection logic per agent

```ts
// cursor.ts
async isInstalled(): Promise<boolean> {
  return fileExists(path.join(resolveHomeDir(), '.cursor'));
}

// claude.ts
async isInstalled(): Promise<boolean> {
  return fileExists(path.join(resolveHomeDir(), '.claude'));
}
```

#### Templates move to `templates/agents/{id}/`

```
templates/agents/cursor/commands/grounder-note.md   (move from templates/cursor/)
templates/agents/claude/commands/grounder-note.md   (new)
```

Each adapter resolves its own template path — no shared template logic needed.

---

### What doesn't change

- `connector/` — zero changes
- `vault/layout.ts`, `vault/write-note.ts` — zero changes
- `commands/note.ts` — zero changes
- `.grounder.json` marker format — zero changes
- Test structure mirrors `src/` already, so `test/agents/` follows naturally

---

### Migration path (additive, no breakage)

1. Add `src/agents/types.ts` + `src/agents/index.ts`
2. Add `src/agents/cursor.ts` — wraps existing `cursor/grounder-note.ts` behind the interface
3. Update `commands/vault/init.ts` to call `resolveAgents()` instead of `installGrounderNoteCommand()` directly
4. Move template to `templates/agents/cursor/`
5. Delete `src/cursor/` once absorbed (or keep as internal module called by cursor adapter)
6. Add `src/agents/claude.ts` stub — `isInstalled()` checks `~/.claude`, `install()` is a no-op until Claude artifacts are designed

Tests for the adapter interface go in `test/agents/cursor.test.ts` (same pattern as `test/connector/`).

---

### One design decision to make

**Should the home config record which agents were installed?**

```json
{ "vaultRoot": "...", "agents": ["cursor"] }
```

Pros: `grounder status` and future upgrade commands know what to re-install.  
Cons: adds state that can go stale (e.g. user uninstalls Cursor).

Recommendation: **start without it**. Auto-detect is stateless and always correct. Add `agents` to home config only if `grounder doctor` or `grounder upgrade` is built — those are the commands that would need it.

---

### Summary

The vault is the stable core. Agent support is a collection of **thin, symmetrical adapters** — each knows its install paths, its templates, and how to detect if it's present. The only shared contract is the `AgentAdapter` interface. `vault/init.ts` becomes agent-blind. Adding Copilot or Windsurf later means adding one file under `src/agents/` and one template directory — nothing else changes.