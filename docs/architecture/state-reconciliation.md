# State reconciliation

How Grounder keeps agent install artifacts in sync after a package upgrade — and why the
design looks this way.

User-facing steps (`grounder migrate`, doctor hints, `--force`) live in
[packages/grounder/README.md](../../packages/grounder/README.md). This doc is for
contributors.

## Problem

Upgrading the `grounder` npm package does not automatically refresh files already written
on the machine (skill files, hook fragments, `~/.grounder/runtime`). Those artifacts can
drift from what the new binary expects, and a previous install shape can leave files behind
that the current shape no longer wants at all.

An earlier design tracked this with per-agent `commandsSchema`/`hooksSchema` integers — a
re-derivation of facts already recoverable from the filesystem, since the schema ints
duplicated what a content-hash compare already answered. This doc describes the reconciler
that replaced it: `setup`, `migrate`, `doctor`, `status`, and `handoff peek` now all call one
of two shared pure functions instead of each maintaining its own opinion about what changed.

## Prior art

- **chezmoi** — source/destination/target state, always recomputed fresh, no schema
  stepping. The three-way compare here (`desired` / `ledger` / `disk`) is the same shape.
- **dpkg conffiles** — old-pristine/new-pristine/on-disk three-way compare, including the
  "on-disk matches what we last installed, safe to auto-update" case.
- **Terraform** — a plan is inert data; `apply` executes it. Drift is a named, first-class
  condition, not something inferred from side effects.
- **Kubernetes controllers** — level-triggered reconcile: full state recomputed every run,
  nothing "stepped." No migration ever "already ran" in a way a future run can't re-derive.
- **Ansible `blockinfile`** / Kubernetes Server-Side Apply (sole-owner case) — the model for
  session hooks specifically (see below): always-converge on a solely-owned region inside a
  shared file, no conflict gate.

Sequential versioned migrations (Flyway/Rails-style) were considered and dropped —
grounder's artifacts are fully re-derivable from templates every run, so there is no state
that genuinely needs a one-way, ordered transform.

## What is versioned, and by what mechanism

| Artifact | Owner | Mechanism |
| --- | --- | --- |
| Agent skill markdown | Grounder-generated, user-editable | Whole-file reconciler (`reconcile()`) |
| Hook config fragment | Grounder-owned key in a shared file | Fragment reconciler (always-converge) — see "Session hooks" |
| Runtime materialization (`~/.grounder/runtime/`) | Grounder-owned | Own health check, not modeled as reconciler state (see below) |
| Install ledger (`~/.grounder/state.json`) | Grounder-owned | `ledgerSchema` int, file-format only |
| Last-used `{{GROUNDER_CLI}}` invocation (`AgentLedgerEntry.lastInvocation`) | Grounder-owned | Not reconciler state — a plain recorded string, replayed only by `desiredDrift`'s caller (see below) |
| Home config (`~/.grounder/config.json`) | Grounder-owned | Not reconciler-managed — see "Out of scope" |
| Repo marker (`.grounder.json`) | Grounder-owned, often committed | Not reconciler-managed — see "Out of scope" |

## The two reconciler shapes

Both live in `src/reconcile/core.ts` and are pure — no I/O, plain data in and out.

### `desiredDrift(desired, ledger) -> DriftEntry[]`

Compares a fresh template-render hash against the ledger's last-applied hash only. No disk
read at all — used by `peek` and `status`, which must stay fast (a session-start hook that
touches `~/.cursor`/`~/.claude` on every launch would be a real cost). "Cheap" here means "no
host-file I/O," not "zero work" — computing `desired` still means rendering and hashing each
adapter's package-local `SKILL.md` templates.

Scoping is baked into the function, not left to callers to remember: `ledger === undefined`
(this agent has no ledger entry — never installed) returns no drift. Callers pass
`ALL_AGENTS`, so without this rule a machine with `~/.cursor` on disk but only Claude ever
configured would get a permanent "run migrate" nag with no command able to silence it. Within
a ledger-recorded agent, a desired path *missing* from its `files` map still counts as drift
— that's how a newly added skill file surfaces here.

One caller-side nuance worth calling out explicitly: `commands/install-drift.ts` (the only
caller) does **not** always render `desired` against its own `process.execPath` the way
`reconcile()`'s caller does. Skill templates bake in a `{{GROUNDER_CLI}}` invocation string,
and that string is invoker-specific (see `docs/architecture/runtime-invocation.md`'s "Drift
checks must not use the checking process's own interpreter path"). `install-drift.ts` instead
replays `AgentLedgerEntry.lastInvocation` — the invocation recorded at this agent's last real
install — so a `status`/`peek` check from a *different* process than whatever last ran
`setup`/`migrate` doesn't manufacture drift purely from that difference. `reconcile()`'s own
callers (`apply.ts`, `doctor.ts`) never do this substitution; they need the live process's own
invocation so a genuine Node switch still surfaces as real drift.

### `reconcile(desired, tombstones, ledger, disk, force) -> PlanEntry[]`

The full three-way: desired (current templates) vs. ledger (last-applied) vs. disk (actual).
One entry per path, action `create | update | delete | conflict | noop | forget`:

- **`create`** — desired, absent on disk.
- **`noop`** — on-disk content already matches desired, regardless of what the ledger says.
  Content equality settles it before the ledger is even consulted.
- **`update`** — on-disk differs from desired, but either `--force` or the ledger's recorded
  hash for that path matches on-disk exactly (Grounder wrote it, safe to refresh).
- **`conflict`** — on-disk differs from desired, and neither `--force` nor a matching ledger
  hash can vouch for it. `blockedAction` on the entry (`"overwrite"` or `"delete"`) records
  which action `--force` would take, since the table needs the wording ("would be
  overwritten" vs. "would be deleted") and `RowStatus` alone can't distinguish them.
- **`delete`** — not in the current desired set (dropped from the manifest, or a tombstoned
  legacy path), present on disk, and the ledger can vouch for it (or `--force`).
- **`noop`** (retirement side) — not desired, absent on disk. Deliberately *not* a recurring
  `delete` — otherwise `doctor` would warn about an already-cleaned-up legacy path forever.
- **`forget`** — not desired, absent on disk, but the ledger still holds a stale hash for it
  (removed outside `migrate`). Ledger-only cleanup, no file action.

`reconcile()` has no concept of "known agent" — it trusts whatever `desired`/`tombstones` it's
given. The safety boundary (never compute a diff for a ledger entry this binary doesn't
recognize, which would treat that entire agent's recorded files as delete candidates) lives
in the caller: `resolveMigrateAgents` resolves ledger keys against `ALL_AGENTS` first, with a
stderr warning for anything unknown, and only known adapters ever reach `reconcile()`.

### `applyPlan()` — the write path

`src/reconcile/apply.ts` executes a plan: for each entry, write/delete the file, then persist
that one path's ledger hash immediately (`setLedgerFileHash`/`forgetLedgerFile`) — per
artifact, not batched after the whole plan runs, so a mid-run crash leaves the ledger
consistent with whatever actually completed. `writeGrounderState` itself is atomic (tmp file
+ rename), so even a single artifact's ledger write can't leave a torn `state.json`.

It returns nothing. Reporting is driven by the `PlanEntry[]` the caller already holds
(`commands/render-artifact-table.ts`'s `rowStatusFromPlanAction`), so there is only one
per-path outcome vocabulary in the codebase rather than a second one the write path could
drift from. Failure is a throw, not a status: every entry that doesn't throw did exactly
what its action says.

A `noop` entry still calls `setLedgerFileHash` (a no-op write if the hash already matches) —
this is what lets a file that happens to already match the template (fresh clone, manual
copy, a wiped ledger) get silently re-adopted into the ledger on the next real run, with
nothing to warn about in the meantime.

## Tombstones: retiring what the ledger never knew about

The reason `agents/claude.ts` / `agents/cursor.ts` each declare a `tombstones(homeDir)` list
(the historical pre-Agent-Skills `~/.cursor/commands/grounder-*.md` /
`~/.claude/commands/grounder-*.md` paths) instead of relying purely on a ledger-manifest diff:
pre-hash-tracking installs never recorded those paths in the ledger at all, so a diff against
`ledger.files` alone is blind to them. `tombstones()` is unioned into the "previous desired"
side of `reconcile()`'s diff — the same path Helm and dpkg take (prune from the *previous
package's* full file list, not from whatever happens to be recorded) — so a tombstoned path
surfaces as a `delete`/`conflict` candidate even with zero ledger history.

The list is a frozen historical fact, deliberately hardcoded rather than derived from
`expectedArtifacts()` (which now describes the *current* schema's layout). Safe to delete
once schema-3 (pre-skill) installs are assumed extinct in the wild — a maintainer call to
make explicitly, not something to automate via a version check.

## The version hard stop (downgrade protection)

Dropping the per-agent schema ints removes the guard that used to catch this case: an older
Grounder binary reconciling a ledger written by a newer one sees "disk hash == ledger's
last-applied hash, but ledger's hash != my (older) desired render" — structurally identical
to the normal "safe auto-update" case, so without a guard the older binary would silently
overwrite newer skill files with older ones.

`connector/state.ts`'s `assertVersionSupportsWrite(running, state)` compares the running
binary's version against `state.grounderVersion` via `util/semver.ts`'s
`packageVersionRelation`. Only `"behind"` (running older than recorded) hard-stops, the same
way `UnsupportedSchemaError` does for `.grounder.json`. `"ahead"` (the ordinary
upgrade-then-migrate case) and `"differs"` (same `x.y.z`, different suffix — this repo's own
dev loop) both proceed; reconcile already handles content correctness via hashes regardless
of the version string.

**Scope: the write path only.** `applyAgentInstalls()` (`commands/apply.ts`) calls this
unconditionally, including on `--dry-run` — a dry-run preview must refuse exactly like a real
run would, so the two never disagree about whether this binary can write at all. `doctor`,
`status`, and `handoff peek` never call it — they keep today's warning
(`package-version-notice.ts`'s `"behind"` branch) and stay
fully functional against a newer ledger. A read-path hard stop would turn "a global 0.7.0
migrated this machine, then `npx grounder@0.6.0 doctor` runs" into a refusal to diagnose
anything, when the only property being protected — an older binary overwriting newer files —
is specifically about writing.

This guard is coarser than the schema ints it replaced (a `0.6.2` binary reconciling a
`0.6.1`-recorded ledger now refuses even when the actual content contract is identical,
where the old per-agent int would have let it through). That's the right trade for a write
guard: false positives cost a "upgrade grounder" message, false negatives risked silent
content regressions.

`ledgerSchema` (a separate int on `state.json` itself) is unrelated to this — it versions the
ledger's own JSON *shape*, independently of install content. `connector/ledger-migrations.ts`
owns a table of `upgradeFromN` steps (currently just `upgradeFrom0`, converting v0.5.0's real
shape — `commandsSchema`/`hooksSchema`, no `ledgerSchema` field — into today's
`hooksEnabled`/`ledgerSchema: 1`); `state.ts`'s `readGrounderState` walks that table in memory
on every read, immediately after `JSON.parse` and ahead of the `grounderVersion`/`agents`
validation, so a v0.5.0 file is transparently upgraded before the rest of the read path ever
sees it. A `ledgerSchema` *newer* than this binary understands is a hard stop
(`UnsupportedSchemaError`, same family as `.grounder.json`'s version guard) — the bytes are
genuinely unparseable by an older binary, not just unsafe to overwrite.

That distinction is why this hard stop applies on **reads**, unlike the `grounderVersion`
"behind" guard above, which is write-only: `ledgerSchema` too-new is a *parse-capability*
stop (an older binary cannot interpret the shape at all, so it has to refuse both reads and
writes), while `grounderVersion` "behind" is a *content-safety* stop (the bytes are perfectly
readable — only overwriting them with an older render is unsafe, so it only needs to guard
writes). They coexist without conflict, but the difference is easy to miss, since it looks at
first glance like this reverses the "Scope: the write path only" decision above.

The user-visible consequence is graceful degradation, not a lockout: against a future
schema-2 ledger, an older binary's `doctor` still runs every non-ledger check and only fails
the `install-state` check; `status` prints one `State: unsupported → upgrade grounder` line;
`handoff peek` stays silent (it already swallows every `readGrounderState` error); only
`migrate` and `setup` — the commands whose job is to write the ledger — refuse outright.

Upgrades never touch disk on their own: a read that upgrades an old shape only changes the
in-memory `GrounderState`, and `status`/`doctor`/`handoff peek` must never write `state.json`
as a side effect of reading it. A real, non-dry-run `setup`/`migrate` persists the upgraded
shape as a side effect of `touchGrounderVersion` (which always writes with `ledgerSchema:
LEDGER_SCHEMA`) firing whenever `grounderVersion` changed — true for every real released
upgrade (v0.5.0 → v0.6.0's version string always differs), so this needs no schema-specific
write condition of its own.

## Session hooks: a fragment reconciler

Hook config lives in a file the user (or other tools) can also write to
(`~/.cursor/hooks.json`, `~/.claude/settings.json`), and Grounder owns exactly one nested
entry inside it — not a whole-file artifact, so it is not modeled through `reconcile()`.
Instead it's Ansible `blockinfile` / Kubernetes Server-Side Apply's sole-owner case:
`agents/hook-fragment.ts` supplies two small pure primitives —
`removeMatchingEntries(entries, isMatch)` and `isAlreadyConverged(entries, isMatch,
canonical)` — that `cursor.ts`/`claude.ts` use inside `installHooks()` to **always
converge**: locate every entry Grounder's recognizer matches (there can be more than one —
a legacy `npx grounder handoff peek` entry alongside a runtime-form one, say), remove all of
them, and insert exactly one canonical entry. No conflict / `--force` gate — there's nothing
a user could have "locally edited" the way a whole skill file can be, so unlike whole-file
artifacts this never reports `modified`.

Claude's shape (`hooks.SessionStart`, an array of `{ matcher, hooks: [...] }` groups) needs
matches collected and removed across *every* group before the single canonical entry is
reinserted; Cursor's shape (`hooks.sessionStart`, a flat array) applies the same primitives
directly. Both funnel through `util/merge-json.ts`'s existing diff-before-write behavior, so
a run that's already converged never touches the file.

`removeHooks()` (new on `AgentAdapter`, alongside `installHooks()`) is the `--no-hooks`
opt-out: it removes every recognizer match without reinserting a canonical entry. The reason
this has to be a real removal, not just a `hooksEnabled: false` flag flip: the ledger's
`hooksEnabled` tri-state (`undefined` / `true` / `false`) drives *hydration* — when
`undefined` and setup/migrate finds an on-disk recognizer match, it's treated as enabled and
persisted as `true`. If `--no-hooks` only flipped the flag without removing the fragment, the
next plain `migrate` would see the still-present entry, treat it as an "already installed,
never explicitly recorded" case, and silently re-hydrate `hooksEnabled` back to `true` — the
exact failure mode a tri-state (vs. a plain boolean, which can't distinguish "never touched"
from "explicitly off") exists to prevent. `commands/apply.ts` routes to `removeHooks()`
instead of `installHooks()` when `--no-hooks` is passed, and persists `hooksEnabled: false`
in the same call.

`hooksEnabled` replaces the old per-agent `hooksSchema` int one-for-one as the "are hooks on
for this agent" signal: `apply-agent-installs.ts`'s old `hooksSchema > 0 OR an on-disk
recognizer match` derivation becomes `hooksEnabled === true`, or (when `hooksEnabled ===
undefined`) the same on-disk recognizer fallback — `false` never falls back to the
recognizer, which is what makes the opt-out sticky.

## Out of scope

The reconciler owns install artifacts: skill files, tombstoned legacy command files, and the
hook fragment. It does **not** cover:

- **`.grounder.json`** (the per-repo marker) — keeps its own `version` int and
  `UnsupportedSchemaError` hard stop, via `connector/repo.ts`.
- **`~/.grounder/config.json`** (home config) — not template-derivable (it's just a vault
  path), no schema versioning at all today; see `connector/home.ts`.

Both are real config files, not re-derivable from a template the way a skill markdown file
is — a future shape change to either needs its own mechanism, not an extension of this one.

## Key code map

| Concern | Location |
| --- | --- |
| Pure reconciler core (`desiredDrift`, `reconcile`, `planChangesLedger`) | `src/reconcile/core.ts` |
| Plan execution (file writes + incremental ledger writes) | `src/reconcile/apply.ts` |
| On-disk hashing helper | `src/reconcile/disk.ts` |
| Ledger read/write, tri-state `hooksEnabled`, version hard stop | `src/connector/state.ts` |
| `ledgerSchema` upgrade table + walker | `src/connector/ledger-migrations.ts` |
| Adapter contract (`desiredArtifacts`, `tombstones`, `expectedArtifacts`) | `src/agents/types.ts` |
| Adapter implementations | `src/agents/cursor.ts`, `src/agents/claude.ts` |
| Orchestration (runtime + per-agent plan/apply + hooks) shared by `setup`/`migrate` | `src/commands/apply.ts` |
| STATUS/TARGET/PATH table rendering | `src/commands/render-artifact-table.ts` |
| `grounder migrate` | `src/commands/migrate.ts` |
| `grounder setup` | `src/commands/setup.ts` |
| `grounder doctor` (dry-run `reconcile()` per agent) | `src/commands/doctor.ts` |
| Cheap drift check shared by `status`/`peek` | `src/commands/install-drift.ts` |
| Fragment reconciler primitives | `src/agents/hook-fragment.ts` |
| Fragment reconciler use (`installHooks`/`removeHooks`) | `src/agents/cursor.ts`, `src/agents/claude.ts` |

## Rejected alternatives

- **Keep per-agent schema ints alongside content hashes** — redundant; every case the ints
  caught, a content-hash compare already catches, more precisely (an int can't tell "content
  contract identical, version string bumped" from "content actually changed").
- **A generic ledger-manifest diff with no tombstones** — blind to pre-hash-tracking installs
  (gap 1's actual historical bug: 0.5.0 shipped command files a naive diff can't see).
- **Version hard stop on every read** — turns a downgrade-protection write guard into a
  diagnostic lockout; see "Scope: the write path only" above.
- **`hooksEnabled` as a plain boolean** — collapses "never recorded" and "explicitly off"
  into one `false`, which makes disk-recognizer hydration silently undo `--no-hooks`.
