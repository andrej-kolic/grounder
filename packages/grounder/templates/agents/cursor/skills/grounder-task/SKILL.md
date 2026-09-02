---
name: grounder-task
description: Hydrate this session from the latest vault handoff and repo truth.
disable-model-invocation: true
---

Hydrate this session from the latest vault handoff and repo truth.

Read-only — do not write to the vault. Do not invent vault paths.

**Special case: the instruction asks to view existing handoffs, not hydrate** (`list`, `list 3 oldest`, `show handoffs`, etc.) → run `{{GROUNDER_CLI}} handoff list --limit <N> --markdown` (N = count named, else 5; ignore order words like "oldest" — output is always newest-first, never resort or relabel it) and stop — no hydrate, no `AGENTS.md`, no “start work.” Relay the CLI stdout as-is (it already includes the count header; title lines are clickable `[relativePath](fileUri)` links).

Otherwise, from the linked project folder or any subdirectory beneath it:

1. Get the current handoff (skips empty/unreadable files, same pick as the session-start teaser):

   {{GROUNDER_CLI}} handoff list --head

2. If empty: tell the user there are no handoffs yet, then read repo `AGENTS.md` only and proceed.

3. Otherwise, read that file. If the user names a specific session instead: `{{GROUNDER_CLI}} handoff list --limit 5 --markdown` → match name/index to the indented absolute path in *this* listing (positional, not a stable id). Miss → once with `--limit 50 --markdown` (*that* listing only). Still miss → tell the user and stop — no guessed hydrate.

4. Read repo `AGENTS.md` (project conventions and constraints).

5. Summarize briefly what is next (from the handoff `## Next` section when present), then start work.

Run {{GROUNDER_CLI}} with `required_permissions: ["all"]` (vault is outside the workspace).
Use free-text after `/grounder-task` as optional focus (session name, index, or task hint).
