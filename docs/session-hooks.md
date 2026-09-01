# Session-start hooks

An opt-in safety net for the session loop: when a Cursor or Claude Code session starts in
a linked project that already has a handoff, Grounder prints **one line** reminding you
it exists. You (or the agent) still decide whether to run `/grounder-task`.

```bash
grounder setup <path-to-your-vault> --hooks
```

Already set up without hooks? `grounder migrate --hooks` adds them.

Example teaser:

```text
[grounder] Latest handoff: "auth middleware" (2026-07-28). Run /grounder-task to load it, or ignore if unrelated.
```

This teaser is a `SessionStart` hook: its output is added to the agent's context, not
printed to your terminal directly — the agent decides whether to mention it.

## statusLine (Claude Code only)

`--hooks` on Claude Code also configures `statusLine` in `~/.claude/settings.json` — a
one-line status Claude Code renders itself at the bottom of the terminal, refreshed each
turn, independent of the agent. Same underlying data as the teaser above, shown directly
instead of routed through the agent's context:

```text
[grounder] handoff: "auth middleware" (2026-07-28) → /grounder-task
```

If a different `statusLine` command is already configured, Grounder leaves it alone
(it's a single global slot, unlike the hooks array) unless you pass `--force`.

The handoff line is a one-time "heads up," not a permanent fixture: it shows on a
session's first render and disappears from the next one — in practice, right after
your first prompt, since that's what triggers `statusLine` to re-render. An ordinary
`--resume`/`--continue` reuses the same session id, so it stays suppressed across a
resume too; `--fork-session` gets a new id and sees it once more. The install-outdated
notice isn't gated by this — it re-checks `state.json` fresh on every render, so it
clears on its own the next time `statusLine` renders after you run `grounder migrate`
(even from a different terminal).

Like the `SessionStart` teaser above, `statusLine`'s install-outdated notice checks
schema drift only — see
[Schema versioning](architecture/schema-versioning.md#schemas-vs-package-version-keep-separate).
It does not also flag a stale recorded `grounderVersion` alone: both hooks run via the
materialized `~/.grounder/runtime` copy, where a `grounderVersion` comparison can't
reliably tell you anything a schema check doesn't already cover (see that doc for why).

## What hooks do not do

- They never auto-load the full handoff body into context
- They never block or delay a session from starting
- Unlinked folders and projects with no handoffs print nothing (exit 0, silent)

`doctor` reports a `warn` (never a `fail`) when a detected agent has no Grounder hook
installed, and when `~/.grounder/runtime` is stale or missing.

Hooks run `~/.grounder/runtime/dist/cli.js` directly rather than `npx` — see
[The shared runtime](upgrading.md#the-shared-runtime) for how that stays current.

See also: [CLI reference](cli-reference.md) · [Configuration](configuration.md) ·
[Upgrading](upgrading.md) · [Troubleshooting](troubleshooting.md)
