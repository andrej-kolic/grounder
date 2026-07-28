# Grounder Phase 3 — `status` + `doctor`

**Status:** complete (Steps 1–4 done)  
**Created:** 2026-07-25  
**Basis:** `.ai/plans/grounder-product-idea.md` (ops layer), Phase 1 connector, Phase 2 handoff  
**Builds on:** home config + repo config (`.grounder.json`) + convention resolution  
  (`status` inspects vault/project independently; write commands still use `resolveLinkedProject`)

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
| **`status`** | Snapshot of vault + project config and resolved paths | Everyday “am I wired?” |
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
| 3 | **Read-only** — never mutate home config, repo config, agent artifacts, or vault |
| 4 | **No uninstall** — doctor may *print* removable paths as hints, never delete |
| 5 | **Stdout human text** — labeled lines; exit non-zero only when useful (see exit codes) |
| 6 | **Reuse connectors** — home/repo/vault/git helpers + agent registry; `status` does **not** short-circuit on `resolveLinkedProject` (inspect pieces separately). Write commands keep `requireLinked` / `resolveLinkedProject` |
| 7 | **Agent artifact check via adapters** — extend `AgentAdapter` with path listing (no new home-config agent list) |
| 8 | **`status` / `doctor` = two sections** — **Machine** (home `config.json` + vault path [+ agent checks in doctor]) and **Project** (repo `.grounder.json` + paths). Label each config file **Config:** (not “Home” / “Marker”). Status vault path label is **Vault:** (not “Root”) |
| 9 | **`Linked:` values** — `yes` (both configs resolve); `no` (project config missing); `incomplete` (project config present, vault/home missing). Omit Notes/Logs until vault exists |

---

## CLI surface

```text
grounder status              Snapshot for cwd (vault + project; partial-state OK)
grounder doctor              Health checks (machine + optional cwd project)
  --global                   Machine-only checks (skip project/link checks)
```

No flags on `status` in v1 (cwd only). Optional later: `--json`.

### Exit codes

| Command | `0` | Non-zero |
| --- | --- | --- |
| `status` | Printed snapshot (including `Linked: no` / `incomplete`) | Unexpected I/O errors only |
| `doctor` | All checks passed | One or more checks failed |

---

## `status` output (target)

Two sections: **Machine** (home config + vault path) and **Project** (repo config + paths).
Each section shows its **Config** file path when present.
Machine and project are inspected **independently**.

When fully linked:

```text
Machine
  Config:     /Users/you/.grounder/config.json
  Vault:      /path/to/vault

Project
  Linked:     yes
  Folder:     /path/to/project
  Config:     /path/to/project/.grounder.json
  Id:         my-app
  Notes:      /path/to/vault/10-Projects/my-app/notes
  Logs:       /path/to/vault/10-Projects/my-app/logs
  Git:        /path/to/project  (branch: main)   # omit line if no git; omit branch if unknown
```

Neither vault nor project configured:

```text
Machine
  Config:     missing → run: grounder vault init <path>

Project
  Linked:     no
```

Project config exists but vault does not (`Linked: incomplete`; no Notes/Logs):

```text
Machine
  Config:     missing → run: grounder vault init <path>

Project
  Linked:     incomplete → run: grounder vault init <path>
  Folder:     /path/to/project
  Config:     /path/to/project/.grounder.json
  Id:         my-app
  Git:        /path/to/project  (branch: main)   # when git present
```

Vault exists but project is not linked:

```text
Machine
  Config:     /Users/you/.grounder/config.json
  Vault:      /path/to/vault

Project
  Linked:     no
  Config:     missing → run: grounder init
```

---

## `doctor` checks (target)

Ordered checklist under **Machine** / **Project** sections (omit Project with `--global`).
Each line: `ok` / `fail` / `warn` + message + fix hint when not ok.

### Machine (always)

| Check | Fail when | Fix hint |
| --- | --- | --- |
| Home config present | `~/.grounder/config.json` missing / invalid | `grounder vault init <path>` |
| Vault reachable | path missing or not a directory | Fix path or re-run vault init |
| `10-Projects/` exists | parent missing | `grounder vault init <path>` (idempotent) |
| Agent commands | detected agent missing expected slash files | `grounder vault init <path> --force` (or `--agent=<id>`) |

### Project (default; skip with `--global`)

| Check | Fail when | Fix hint |
| --- | --- | --- |
| Repo config | no `.grounder.json` uptree | `grounder init` |
| Repo config valid | missing/invalid `projectId` | Fix or re-run `grounder init --force` |
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
    status.ts             # grounder status (done)
    doctor.ts             # grounder doctor [--global]
test/
  commands/check.test.ts  # done
  commands/status.test.ts # done
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

- [x] `commands/status.ts` — resolve vault + project independently (partial-state; no `requireLinked` early-exit UX)
- [x] Two sections (Machine / Project); `Config:` for both config files; Machine `Vault:` path; `Linked:` yes | no | incomplete
- [x] Print snapshot fields (folder, id, notes, logs, git/branch when applicable)
- [x] `cli.ts` route + help
- [x] Tests: linked; neither configured; vault without project; project without vault

### Step 3 — `doctor`

- [x] `commands/doctor.ts` — run machine checks; unless `--global`, run project checks for cwd
- [x] Print one line per check; summarize pass/fail count
- [x] Exit `1` if any `fail` (warns alone → still `0`)
- [x] `cli.ts` route + help
- [x] Tests: healthy linked project; missing home; missing repo config; missing agent command file; `--global` skips project checks

### Step 4 — Docs + quality

- [x] Update `packages/grounder/README.md` (status/doctor in quickstart / troubleshooting)
- [x] Mention in root README if useful
- [x] `pnpm check` green

---

## Acceptance criteria

1. From a linked repo, `grounder status` shows project Id + notes/logs paths that match `path notes` / `path logs`
2. From an unlinked folder with home config, `status` says Project `Linked: no` and hints `grounder init` under Project Config
3. From a folder with `.grounder.json` but no home config, `status` says Project `Linked: incomplete` and still shows Folder / Config / Id
4. `doctor` fails with a fix hint when vault is missing
5. `doctor` fails when a detected agent’s Grounder command file is absent
6. `doctor --global` does not require `.grounder.json`
7. Neither command creates, overwrites, or deletes any file

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
