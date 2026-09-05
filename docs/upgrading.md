# Upgrading

**Minimum Node.js bumped to 22** (from 18) as of 0.6 — Node 18 and 20 are both past their
own end-of-life dates, and CI only exercises 22 and 24. `npm`/`pnpm` warn rather than
hard-fail on an `engines` mismatch by default, so an older Node can still run Grounder in
practice, but it's unsupported and untested.

Upgrading the npm package does not by itself refresh the skills and shared
runtime that `grounder setup` installed under your home directory. One command does:

```bash
grounder migrate
```

Run `grounder doctor` if you're unsure — it hints when plain `migrate` is enough vs
`migrate --force` (needed **once** when upgrading from Grounder before 0.3, or when
command files were edited locally). Most Grounder commands and session-start teasers will
also tell you when a migrate is due.

- [Migrate flags](#migrate-flags)
- [The shared runtime](#the-shared-runtime)

See also: [CLI reference](cli-reference.md) · [Configuration](configuration.md) ·
[Troubleshooting](troubleshooting.md)

## Migrate flags

| Flag           | Description                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `--force`      | Overwrite skill files you edited locally; also needed **once** when upgrading from Grounder before 0.3 |
| `--dry-run`    | Preview without writing                                                                                        |
| `--agent <id>` | Limit to a specific agent (repeatable)                                                                         |
| `--hooks`      | Install hooks even if they were never installed before                                                          |
| `--no-hooks`   | Turn hooks off and remove the installed hook entry (sticky — a later plain `migrate` will not re-enable it)     |

Untouched skill files update automatically; locally edited ones (and pre-0.3 installs
with no ledger) are skipped unless you pass `--force`. `setup --force` still works for
scripts that already use it — it shares the same install path as `migrate`.

**Upgrading from before 0.6** (`grounder-*.md` command files, not yet `SKILL.md`):
`migrate` installs the new skill files and then deletes the old `~/.cursor/commands/` /
`~/.claude/commands/grounder-*.md` files, but only ones it can prove are untouched (hash
matches what Grounder last wrote). `--force` also deletes ones you edited locally —
those edits are **not** ported into the new `SKILL.md`, so back up any customizations
first. Files it can't safely delete are left in place and `grounder doctor` will keep
flagging them (they can otherwise cause a duplicate `/grounder-*` menu entry) until you
re-run with `--force`. Note that `grounder setup` never does this cleanup, even with
`--force` — only `migrate` retires old install shapes.

Contributor detail on the install ledger and hash drift:
[State reconciliation](architecture/state-reconciliation.md).

## The shared runtime

Hooks *and* skills both run `~/.grounder/runtime/dist/cli.js` directly (never
`npx`), so they don't depend on whatever `grounder` happens to be on your `PATH`.
`setup` materializes that runtime whether or not `--hooks` is passed, in one of two ways:

- **Real install** (`npm i -g grounder`, `pnpm add -g grounder`, or a monorepo checkout)
  → symlinked. Upgrading overwrites the same path in place, so both stay current with
  **no re-run needed**.
- **Bare** `npx grounder setup …` (nothing installed) → copied (`dist/`, plus
  `package.json` and `templates/` alongside it), since each `npx`
  invocation resolves to a disposable, version-pinned cache dir that can't be symlinked
  durably. Re-run `grounder migrate` (or `setup`) after upgrading to refresh — no
  `--force` needed.

If you want the runtime to stay current with zero maintenance, install Grounder rather
than using bare `npx` for this step.

That refresh only touches the shared runtime, not installed skill files — if `doctor`
flags skill drift, that's the `migrate` above.

Contributor detail: [Runtime invocation](architecture/runtime-invocation.md).
