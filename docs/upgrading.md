# Upgrading

Upgrading the npm package does not by itself refresh the slash commands and shared
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
| `--force`      | Overwrite slash command files you edited locally; also needed **once** when upgrading from Grounder before 0.3 |
| `--dry-run`    | Preview without writing                                                                                        |
| `--agent <id>` | Limit to a specific agent (repeatable)                                                                         |
| `--hooks`      | Install hooks even if they were never installed before                                                          |

Untouched command files update automatically; locally edited ones (and pre-0.3 installs
with no ledger) are skipped unless you pass `--force`. `setup --force` still works for
scripts that already use it — it shares the same install path as `migrate`.

Contributor detail on the install ledger and hash drift:
[Schema versioning and install migration](architecture/schema-versioning.md).

## The shared runtime

Hooks *and* slash commands both run `~/.grounder/runtime/dist/cli.js` directly (never
`npx`), so they don't depend on whatever `grounder` happens to be on your `PATH`.
`setup` materializes that runtime whether or not `--hooks` is passed, in one of two ways:

- **Real install** (`npm i -g grounder`, `pnpm add -g grounder`, or a monorepo checkout)
  → symlinked. Upgrading overwrites the same path in place, so both stay current with
  **no re-run needed**.
- **Bare** `npx grounder setup …` (nothing installed) → copied, since each `npx`
  invocation resolves to a disposable, version-pinned cache dir that can't be symlinked
  durably. Re-run `grounder migrate` (or `setup`) after upgrading to refresh — no
  `--force` needed.

If you want the runtime to stay current with zero maintenance, install Grounder rather
than using bare `npx` for this step.

That refresh only touches the shared runtime, not installed command files — if `doctor`
flags command drift, that's the `migrate` above.

Contributor detail: [Runtime invocation](architecture/runtime-invocation.md).
