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
