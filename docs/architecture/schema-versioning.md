# Schema versioning and install migration

How Grounder keeps agent install artifacts in sync after a package upgrade — and why the design looks this way.

User-facing steps (`grounder migrate`, doctor hints, `--force`) live in [packages/grounder/README.md](../../packages/grounder/README.md). This doc is for contributors.

## Problem

Upgrading the `grounder` npm package does not automatically refresh files already written on the machine (slash commands, hook fragments, `~/.grounder/runtime`). Those artifacts can drift from what the new binary expects.

Early versions relied on ad-hoc detection (e.g. regex sniffing for `npx` in command files) and told users to re-run `vault init --force`. That conflated first-time setup with routine upgrades, clobbered hand-edited commands unless the user opted in carefully, and had no clean answer for “this machine was touched by a *newer* grounder than the binary currently running.”

## What is versioned

Grounder writes several persistent artifacts. They need **different** upgrade rules:

| Artifact | Owner | Location | User-editable? | Upgrade rule |
| --- | --- | --- | --- | --- |
| Slash command markdown | Grounder-generated | `~/.cursor/commands/grounder-*.md`, `~/.claude/commands/grounder-*.md` | Yes (by design) | Hash-safe update; `--force` if edited |
| Hook config fragment | Grounder-owned key in a shared file | Cursor `hooks.json` / Claude `settings.json` | No (that nested entry) | Always regenerate on install/migrate |
| Runtime materialization | Grounder-owned | `~/.grounder/runtime/` | No | Always refresh |
| Home config | Grounder-owned | `~/.grounder/config.json` | Path may be hand-edited | Not schema-migrated here |
| Repo marker | Grounder-owned, often committed | `.grounder.json` (`version` + `projectId`) | Rarely | Forward-compat hard stop if `version` too new |
| Install ledger | Grounder-owned | `~/.grounder/state.json` | No | Written by vault init / migrate |

The important split is **owned JSON / runtime** vs **user-editable markdown**. The rest of the design follows from that.

## Prior art (why these analogies)

| Precedent | Idea we reuse |
| --- | --- |
| **git** `repositoryformatversion` | Old binary meets newer on-disk schema → refuse rather than guess |
| **npm** `lockfileVersion` | Fully owned files may be rewritten in place on the next “install” |
| **chezmoi** apply hashes | Record what we last wrote; if on-disk still matches, safe to overwrite; if not, conflict |
| **Rails `app:update` / Angular `ng update`** | Scaffolding and upgrading generated files are different verbs |
| **Home Assistant config-entry migrations** | Integer schema on owned state; bump + transform (here: regenerate) without user ceremony |

We do **not** pin a per-project Grounder version (Corepack-style). Install state is machine-global (`~/.grounder/`), while `.grounder.json` only needs a small forward-compat guard because it may live in old commits.

## Design

### Two migration strategies

1. **Owned fragments** (hooks entry, runtime, ledger): always refresh on `vault init` / `migrate`. No `--force` required.
2. **Command markdown**: chezmoi-style drift detection.
   - On write, record per file: `hash` (exact rendered bytes Grounder wrote — not the raw template).
   - Later: on-disk hash == recorded hash → file untouched → safe auto-update without `--force`.
   - On-disk hash != recorded (or no recorded hash) → treat as user-edited / legacy → leave alone; report; require `--force` to overwrite.

Missing ledger or missing per-file hash is **schema 0 / legacy**: same protective path as “user edited,” which is why a one-time `migrate --force` is needed when upgrading from pre-ledger installs.

### Adapter-declared schemas

Each `AgentAdapter` exposes:

- `commandsSchema` — bump when `install()` contract changes (placeholders, file set, frontmatter).
- `hooksSchema` (optional) — bump when `installHooks()` contract changes.

Values are compile-time constants next to the install code (`cursor.ts`, `claude.ts`), not a hand-maintained table elsewhere. They are recorded into the ledger so doctor and hooks can compare integers instead of sniffing file contents.

Per-agent granularity costs a little bookkeeping; it pays off when Cursor and Claude templates diverge in timing. Today both agents often bump together — that is fine.

### Ledger: `~/.grounder/state.json`

Module: [`connector/state.ts`](../../packages/grounder/src/connector/state.ts).

```json
{
  "grounderVersion": "0.8.0",
  "agents": {
    "cursor": {
      "commandsSchema": 1,
      "hooksSchema": 1,
      "files": {
        "/Users/x/.cursor/commands/grounder-note.md": {
          "hash": "sha256:…"
        }
      }
    }
  }
}
```

#### Per-file `hash`

Each entry under `files` carries a content hash:

| Field | Means |
| --- | --- |
| `hash` | Bytes Grounder last wrote. Used to detect local edits. |

Agent-level `commandsSchema` / `hooksSchema` are the rollup used by peek, doctor “stale?”, migrate decisions, and forward-compat hard stops. File entries used to also carry a `schema` (mirroring the agent’s); it was dropped because nothing consulted a lower per-file schema and the higher-schema check duplicated the agent-level one. Legacy on-disk `schema` keys are ignored.

Invariants:

- Missing file or missing agent entry → treat recorded schema as **0** (legacy).
- Agent schema **less than** this binary’s adapter → stale → user should `grounder migrate`.
- Agent schema **greater than** this binary’s adapter → **forward-compat hard stop** (`UnsupportedSchemaError`: upgrade grounder). Same idea for `.grounder.json`’s `version` vs `SUPPORTED_REPO_VERSION` in [`connector/repo.ts`](../../packages/grounder/src/connector/repo.ts).
- Ledger agent ids this binary does not know → skip with a stderr warning on `migrate` (still refresh known agents); explicit `--agent=<unknown>` still errors.
- Corrupt ledger → fail with a clear “fix or remove, then migrate” message (distinct from “newer than me”).
- `migrate` / vault init **must not** advance `commandsSchema` when every command artifact was left as `modified` (legacy or local edits). Runtime/`grounderVersion` (and hooks, when refreshed) may still update; doctor keeps the schema-stale / `--force` hint until a real command write lands.
### `grounder migrate` (not only `vault init --force`)

`vault init` is “point this machine at a vault and install.” Reusing it as the routine post-upgrade action forces retyping a path and mixes first-time setup with keep-current.

`grounder migrate`:

- No vault path — reads home config (points at `vault init` if missing).
- Agents: explicit `--agent`, else keys already in the ledger, else auto-detect (legacy).
- Shares install implementation with `vault init` via [`apply-agent-installs.ts`](../../packages/grounder/src/commands/apply-agent-installs.ts).
- `--dry-run`, `--force`, `--hooks` as documented in the package README.

`vault init --force` remains supported for existing scripts; it calls the same path.

### How users learn they need to migrate

Three channels, no new product surface:

| Channel | Role |
| --- | --- |
| **`grounder doctor` / `status`** | Checks install state. Schema stale → warn + migrate. Schema too new → fail (upgrade grounder). Also shows package mismatch when present. Missing/non-executable Node in hooks or commands → fail + migrate ([details](./runtime-invocation.md)). |
| **Session hook / `handoff peek`** | Checks **schemas only**. One-line teaser: `Install outdated — run: grounder migrate`. No auto-migrate. |
| **CLI upgrade banner** | Checks **`grounderVersion` only**. Package newer → migrate. Package older → install a newer Grounder. Skipped for peek, migrate, and vault init. |

#### Schemas vs package version (keep separate)

These are two different checks. Do not mix them.

| Field | What it means | Used by |
| --- | --- | --- |
| `commandsSchema` / `hooksSchema` | Did the install shape change? (files, placeholders, hooks) | Peek, doctor schema checks, hard stop if too new |
| `grounderVersion` | Which package last wrote the ledger? | CLI banner, doctor/status package line |

Why peek ignores `grounderVersion`: peek always says “run migrate.” But a package mismatch can also mean “this Grounder is too old — upgrade the package.” Wrong hint. The CLI banner handles that case. `cli.ts` skips the banner for peek on purpose.

For maintainers: bumping the package version is **not** enough for session hooks to warn. Bump the adapter schema when install output changes. That is what peek looks at.

```mermaid
flowchart TD
  Upgrade["User upgrades grounder package"] --> NextRun["Next grounder command"]
  NextRun --> Banner["stderr: package vs ledger"]
  NextRun --> Hook["Session peek: schema only"]
  NextRun --> Doctor["grounder doctor"]
  Hook --> Teaser["Install outdated teaser"]
  Doctor --> Warn["warn: schema and/or package"]
  Teaser --> Migrate["grounder migrate"]
  Warn --> Migrate
  Banner --> Migrate
  Migrate --> Owned["Owned JSON / runtime: always refresh"]
  Migrate --> Cmds["Command markdown: per-file hash"]
  Cmds -->|"hash matches ledger"| Auto["Auto-update"]
  Cmds -->|"no hash or hash differs"| Skip["Skip unless --force"]
```

## Key code map

| Concern | Location |
| --- | --- |
| Install "out of date?" helpers | `connector/state.ts` — `isInstallSchemaStale` for peek/status (state file only; hooks never enabled ≠ out of date). Doctor uses migrate dry-run for on-disk drift, plus ledger schema-lag when files already match |
| Shared “newer schema” error type | `connector/unsupported-schema.ts` |
| Repo marker version guard | `connector/repo.ts` |
| Hash of rendered command bytes | `util/hash.ts` + `agents/install-command.ts` |
| Adapter schema fields | `agents/types.ts`, `cursor.ts`, `claude.ts` |
| Shared install + ledger update | `commands/apply-agent-installs.ts`, `agents/index.ts` (`recordAgentInstallState`) |
| `grounder migrate` | `commands/migrate.ts` |
| Doctor / status checks | `commands/doctor.ts`, `commands/status.ts` |
| Peek teaser | `commands/handoff/peek.ts` |
| Upgrade banner | `commands/upgrade-banner.ts`, `commands/package-version-notice.ts`, `util/semver.ts`, wired from `cli.ts` |

## Rejected alternatives

- **Only `vault init --force` for upgrades** — wrong verb; requires vault path; trains users to force-clobber.
- **Auto-migrate from the session hook** — hooks must stay fast and side-effect-free.
- **Make peek also check `grounderVersion`** — peek can only say “run migrate,” but package mismatch sometimes means “upgrade grounder.” Keep schema and package checks separate (see above).
- **Name the command `upgrade`** — confuses with upgrading the npm package itself.
- **Compare on-disk files to shipped templates** — rendered output is machine-specific (`{{GROUNDER_CLI}}`); only “bytes we last wrote” is a valid hash baseline.
- **Content sniffing for every future migration** — does not scale; ledger + integer schemas replace one-off detectors after the legacy bootstrap.

## Maintainer checklist

When changing install output:

1. Bump `commandsSchema` and/or `hooksSchema` on the affected adapter(s). Peek only warns after a schema bump — not after a package bump alone.
2. Ensure install still records per-file hashes for command markdown.
3. Extend doctor messages if a new failure mode needs a distinct hint.
4. Run `pnpm check`.
5. After release, users with an existing ledger run plain `grounder migrate`; pre-ledger installs may need one `migrate --force`.
