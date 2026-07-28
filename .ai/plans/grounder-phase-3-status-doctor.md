# Grounder Phase 3 — `status` + `doctor`

**Status:** planned  
**Created:** 2026-07-25  
**Basis:** `.ai/plans/grounder-product-idea.md` (ops layer), Phase 1 connector, Phase 2 handoff  
**Builds on:** marker + home + convention resolution (`resolveLinkedProject`)

> Ops tooling only. No cleanup / uninstall / vault deletion in this phase.

---

## One-line goal

> **Make “why isn’t memory working?” answerable in one CLI call — inspect link state (`status`), verify health with fix hints (`doctor`).**

```text
grounder status   → what is linked / where do paths resolve?
grounder doctor   → what is broken / how do I fix it?
```

---

## Split

| Command | Job | Audience |
| --- | --- | --- |
| **`status`** | Snapshot of current project link + resolved paths | Everyday “am I wired?” |
| **`doctor`** | Checklist of health checks + actionable fixes | Support / debug |

Both are **read-only**. Neither writes config, agent files, or vault content.

---

## Out of scope

| Deferred | Why |
| --- | --- |
| `cleanup` / `uninstall` / `unlink` | Separate product decision; doctor lists paths only |
| Vault note/log deletion | Never automatic |
| MCP checks | No MCP in current architecture |
| Bridge refresh / `--refresh` | No bridge yet |
| Agent slash commands for status/doctor | CLI is enough; agents can run CLI |
| Auto-fix / reinstall | Doctor points to `vault init --force` / `init` |

---

## Locked decisions

| # | Decision |
| --- | --- |
| 1 | **`status` = snapshot**, **`doctor` = checks** — do not merge into one command |
| 2 | **Partial-state friendly** — report missing pieces; do not hard-bail on first gap (unlike write commands) |
| 3 | **Read-only** — never mutate home config, marker, agent artifacts, or vault |
| 4 | **No uninstall** — doctor may *print* removable paths as hints, never delete |
| 5 | **Stdout human text** — labeled lines; exit non-zero only when useful (see exit codes) |
| 6 | **Reuse connectors** — `resolveLinkedProject`, vault resolvers, agent registry; add inspect helpers as needed |
| 7 | **Agent artifact check via adapters** — extend `AgentAdapter` with path listing (no new home-config agent list) |

---

## CLI surface

```text
grounder status              Snapshot for cwd (linked project)
grounder doctor              Health checks (machine + optional cwd project)
  --global                   Machine-only checks (skip project/link checks)
```

No flags on `status` in v1 (cwd only). Optional later: `--json`.

### Exit codes

| Command | `0` | Non-zero |
| --- | --- | --- |
| `status` | Printed snapshot (even if not linked — report “not linked”) | Unexpected I/O errors only |
| `doctor` | All checks passed | One or more checks failed |

---

## `status` output (target)

When linked:

```text
Linked:     yes
Folder:     /path/to/project
Marker:     /path/to/project/.grounder.json
Project:    my-app
Vault:      /path/to/vault
Notes:      /path/to/vault/10-Projects/my-app/notes
Logs:       /path/to/vault/10-Projects/my-app/logs
Git:        /path/to/project  (branch: main)   # omit branch if unknown
```

When not configured / not linked — still print what is known + short next step:

```text
Linked:     no
Home:       missing → run: grounder vault init <path>
```

or

```text
Linked:     no
Home:       /path/to/vault
Marker:     missing → run: grounder init
```

---

## `doctor` checks (target)

Ordered checklist. Each line: `ok` / `fail` / `warn` + message + fix hint when not ok.

### Machine (always)

| Check | Fail when | Fix hint |
| --- | --- | --- |
| Home config present | `~/.grounder/config.json` missing / invalid | `grounder vault init <path>` |
| Vault root reachable | path missing or not a directory | Fix path or re-run vault init |
| `10-Projects/` exists | parent missing | `grounder vault init <path>` (idempotent) |
| Agent commands | detected agent missing expected slash files | `grounder vault init <path> --force` (or `--agent=<id>`) |

### Project (default; skip with `--global`)

| Check | Fail when | Fix hint |
| --- | --- | --- |
| Repo marker | no `.grounder.json` uptree | `grounder init` |
| Marker valid | missing/invalid `projectId` | Fix or re-run `grounder init --force` |
| Notes dir exists | resolved `notes/` missing | `grounder init` (creates dirs) |
| Logs dir exists | resolved `logs/` missing | `grounder init` |

**Warn (not fail):** agent detected but none of its command files present; git absent (optional). Do not fail solely because `logs/` is empty (valid for new projects).

---

## Package additions

```text
packages/grounder/src/
  agents/
    types.ts              # + expectedArtifacts(homeDir?) → string[]
    cursor.ts / claude.ts # implement path listing
  commands/
    check.ts              # CheckResult + ok/fail/warn helpers
    status.ts             # grounder status
    doctor.ts             # grounder doctor [--global]
test/
  commands/status.test.ts
  commands/doctor.test.ts
```

Wire routes + help in `cli.ts`. Prefer small pure helpers for check results (easy unit tests) over fat CLI functions.

---

## Implementation steps

### Step 1 — Inspect helpers

- [x] AgentAdapter: add read-only artifact path API (e.g. `expectedArtifacts(homeDir?) → string[]`)
- [x] Implement for Cursor + Claude (same paths install uses)
- [x] Optional shared check types: `{ id, level, message, fix? }`

### Step 2 — `status`

- [ ] `commands/status.ts` — resolve home + linked project without `requireLinked` early-exit UX
- [ ] Print snapshot fields (linked, marker, projectId, vault, notes, logs, git/branch)
- [ ] `cli.ts` route + help
- [ ] Tests: linked fixture; no home; home but not linked

### Step 3 — `doctor`

- [ ] `commands/doctor.ts` — run machine checks; unless `--global`, run project checks for cwd
- [ ] Print one line per check; summarize pass/fail count
- [ ] Exit `1` if any `fail` (warns alone → still `0`)
- [ ] `cli.ts` route + help
- [ ] Tests: healthy linked project; missing home; missing marker; missing agent command file; `--global` skips project checks

### Step 4 — Docs + quality

- [ ] Update `packages/grounder/README.md` (status/doctor in quickstart / troubleshooting)
- [ ] Mention in root README if useful
- [ ] `pnpm check` green

---

## Acceptance criteria

1. From a linked repo, `grounder status` shows projectId + notes/logs paths that match `path notes` / `path logs`
2. From an unlinked folder with home config, `status` says not linked and hints `grounder init`
3. `doctor` fails with a fix hint when vault root is missing
4. `doctor` fails when a detected agent’s Grounder command file is absent
5. `doctor --global` does not require `.grounder.json`
6. Neither command creates, overwrites, or deletes any file

---

## Relationship to other docs

| Doc | Role |
| --- | --- |
| `grounder-product-idea.md` | Ops = layer 6 after session loop |
| `grounder-phase-1-minimal-connector.md` | Connector foundation |
| `grounder-phase-2-handoff.md` | Session loop (complete); deferred status/doctor here |
| `grounder-init-cli.md` | Historical — ignore MCP/registry doctor items |
| This plan | Active implementation plan for Phase 3 |

---

## Next after this phase

Unlink / vault uninstall (agent glue only), capture types (`plan` / `decision`), or `0.1.0` publish — choose based on dogfood, not this plan.
