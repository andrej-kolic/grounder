# Migration runner

How `grounder migrate` retires filesystem artifacts left behind by an older install shape — and
why the runner that does it is not schema-gated.

This doc covers the runner in [`src/migrations/`](../../packages/grounder/src/migrations/). It
assumes [`schema-versioning.md`](./schema-versioning.md) — the ledger (`~/.grounder/state.json`),
`commandsSchema`, and the ledger's per-file `hash`. This doc is about a different, narrower thing:
one-way cleanup of files a *previous* install shape wrote, that the *current* install shape no
longer wants on disk at all (as opposed to refreshing a file's content in place, which
`installCommandFile` already handles).

## Problem

Bumping `commandsSchema` changes what an adapter's `install()` writes, but it does not remove what
an *older* schema wrote. The first such case: schema 3 → 4 moved slash-command markdown from
`~/.cursor/commands/grounder-*.md` / `~/.claude/commands/grounder-*.md` to
`~/.cursor/skills/grounder-*/SKILL.md` / `~/.claude/skills/grounder-*/SKILL.md` (Agent Skills
packaging). `grounder migrate` installs the new files but has no reason to know about the old
ones — `install()` only knows the *current* schema's file set. Left alone, an upgraded machine ends
up with both the old and new command surface installed at once, which can show a host's command
menu twice for the same `/grounder-*` entry.

## Design

### Layout

One file per migration: `src/migrations/<NNN>-<slug>.ts`, where `<NNN>` is a zero-padded ordinal
(not the `commandsSchema` value itself — a migration can exist without a schema bump, and multiple
migrations can share one bump). Each file exports a single `Migration`:

```ts
interface Migration {
  schemaVersion: number; // metadata only — which release introduced it
  description: string;
  run(ctx: MigrationContext): Promise<MigrationArtifactResult[]>;
}
```

Every migration is registered explicitly in [`src/migrations/index.ts`](../../packages/grounder/src/migrations/index.ts) as a plain
array (`MIGRATIONS`), in the order they should run. No filesystem/glob discovery — that's fragile
under the bundled/pkg CLI build (a `dist/` layout doesn't guarantee directory listing behaves like
the source tree), and an explicit array keeps ordering a code review decision, not a side effect of
file naming.

### The runner is not schema-gated

`runMigrations()` calls **every** registered migration's `run()` on **every** `grounder migrate`
call, regardless of what `commandsSchema` is currently recorded in the ledger. This is deliberate,
not an oversight: gating a migration on "only run if the ledger's schema is still behind" would
reintroduce the exact bug this runner exists to prevent. Consider a legacy file that fails to
retire because it was hand-edited (`left-modified`, needs `--force`). If the runner stopped
attempting the migration once `commandsSchema` had already advanced past the version that
introduced it — which happens on the very first successful `migrate`, since command-install and
migration-run are independent steps in the same call — that `left-modified` file would go
unreported by every `migrate` from then on, even though it is still sitting on disk causing the
duplicate-menu-entry problem.

Instead, each migration is responsible for its own idempotency. `004-retire-legacy-commands.ts`
does this with the same existence/hash-check shape `installCommandFile` already uses for the
opposite direction (writing, not deleting):

- File missing → `already-absent`. Silent, zero-cost steady state — this is what every subsequent
  `migrate` call converges to once cleanup has actually succeeded.
- File present, on-disk hash matches the ledger's recorded hash for that path (or `--force`) →
  delete it → `retired`.
- File present, hash doesn't match (or no recorded hash — pre-ledger install) → leave it →
  `left-modified`, reported every time until the user re-runs with `--force`.

The legacy path list itself (`legacyCommandArtifacts`) is hardcoded, not derived from
`expectedArtifacts()` — it's a frozen historical fact about what schema 3 used to write, and must
stay frozen even after `expectedArtifacts()` moves on to describe schema 4's layout. Safe to delete
this migration file entirely once schema-3 (pre-skill) installs are assumed extinct in the wild —
that's a maintainer call to make explicitly by removing it from `MIGRATIONS`, not something to
automate via a version check.

### `--force` and `--dry-run`

Both flags carry the same meaning they already have for command install:

- `--force` accepts losing a local edit. A `left-modified` legacy file is deleted under `--force`
  the same way a locally-modified skill file is overwritten under `--force` — `migrate`'s output
  distinguishes the two (delete vs. overwrite) since `--force` does something different to each.
- `--dry-run` previews without touching disk: a retirable legacy file shows as `deleted` in the
  STATUS/TARGET/PATH table (dry-run and a real run use the same table word — see
  `render-artifact-table.ts`'s `TABLE_LABEL`), and a `left-modified` one shows as `conflict`, listed
  in the "left alone" footer below the table. `already-absent` never appears in either — it's not a
  decision, it's nothing happening.

### Wired into `migrate` only, never `setup`

`runMigrations()` is called from [`commands/migrate.ts`](../../packages/grounder/src/commands/migrate.ts) after `applyAgentInstalls()`, and
nowhere else. A fresh `grounder setup` has nothing to retire — there is no prior install shape on a
machine that has never run Grounder before — so wiring this into the shared
`apply-agent-installs.ts` path (used by both `setup` and `migrate`) would be doing work that can
never apply on first install.

### Forward-only, no rollback

Migrations here are one-way filesystem edits on a user's real machine — delete a file, install a
skill. There is no meaningful "down" migration to write (what would undeleting a file even mean once
its bytes are gone?). This follows Flyway's stance over Rails/Django's: if a migration turns out to
be wrong, write a new corrective migration, not an automated rollback of the old one.

### State updates happen per-migration, not batched

`004-retire-legacy-commands.ts` does write to `state.json`: `retireOne` calls `forgetRecordedFile`
to drop a retired path's stale hash entry, both right after a successful delete and when the file
is already gone but the ledger still holds a hash for it (removed outside `migrate`). This is
narrower than the ledger bookkeeping `apply-agent-installs.ts` owns for the *current* schema's
files (`commandsSchema`, per-file hashes on write) — retirement only ever drops one key so a deleted
path doesn't linger, it never rewrites a hash for a live artifact. The write happens immediately
after that migration's own success inside `run()`, not batched after the full `runMigrations()`
loop — a mid-run crash should leave the ledger consistent with whatever migrations actually
completed, not silently behind them. Any *future* migration that needs to persist something new to
the ledger should follow the same immediate-write shape.

## Maintainer checklist

1. New migration → new `src/migrations/<NNN>-<slug>.ts` file, registered in `index.ts`'s
   `MIGRATIONS` array. Don't add migration logic inline elsewhere.
2. `run()` must be safe to call unconditionally, every `migrate`, forever — no schema gate, no
   "only on first upgrade" flag. Idempotency is the migration's own job (existence/hash checks, not
   a run-once marker).
3. Never mutate `expectedArtifacts()` or any *current* adapter path to reference old-schema
   locations for a migration's own bookkeeping — hardcode the old paths directly in the migration
   file, same as `legacyCommandArtifacts`.
4. Respect `--force` / `--dry-run` the same way command install does.
5. Format output for humans, not for exhaustiveness: `migrate`'s STATUS/TARGET/PATH table uses one
   word per outcome, identical in `--dry-run` and a real run (`unchanged`/`created`/`updated`/
   `deleted`/`conflict`) — don't invent a "would leave" / "left" tense pair for an outcome that
   never actually differs; dry-run-ness is announced once above the table, not re-conjugated per
   row. And a status that can repeat across many files (e.g. `left-modified`, shown as `conflict`)
   belongs in one grouped footer block listing every path once (`renderModifiedNote` in
   `render-artifact-table.ts`, shared by `setup` and `migrate`), not a second per-file line beyond
   its table row — a per-file line is for something that actually happened to that specific file
   (created, overwritten, deleted).
