---
name: grounder-recall
description: Recall this session from the latest vault handoff and repo truth.
disable-model-invocation: true
---

Recall this session from the latest vault handoff and repo truth.

**Mode lock — load only.**
- Never write to the vault, regardless of typed extra text (save / handoff / checkpoint / continue in a new session) — never run `{{GROUNDER_CLI}} handoff` (write). Still do this command's job, then add one sentence: did not save — run `/grounder-handoff`. Skip that sentence when the mention only appears in stale payload text.
- Typed extra text is only what the user wrote after `/grounder-recall` in the chat line — empty or bare command means no extra instruction; ignore any sibling verb that shows up only in a leftover command-payload wrapper.
- `#N` is a session pick only when the typed text *is* a selector (`#1`, `resume auth-middleware`). If `#N` sits inside save/explain prose instead, load the latest — do not guess an index.

Read-only — do not write to the vault. Do not invent vault paths.

**Special case: the instruction asks to view existing handoffs, not recall** (`list`, `list 3 oldest`, `show handoffs`, etc.) → run `{{GROUNDER_CLI}} handoff list --limit <N> --markdown` (N = count named, else 5; ignore order words like "oldest" — output is always newest-first, never resort or relabel it) and stop — no recall, no `AGENTS.md`, no “start work.” Relay the CLI stdout as-is (it already includes the count header; title lines are clickable `[relativePath](fileUri)` links).

Otherwise, from the linked project folder or any subdirectory beneath it:

1. Get the current handoff (skips empty/unreadable files, same pick as the session-start teaser):

   {{GROUNDER_CLI}} handoff list --head

2. If empty: tell the user there are no handoffs yet, then read repo `AGENTS.md` only and proceed.

3. Otherwise, state the path from step 1 to the user, then read that file. If the user names a specific session instead: `{{GROUNDER_CLI}} handoff list --limit 5 --markdown` → match name/index to the indented absolute path in *this* listing (positional, not a stable id). Miss → once with `--limit 50 --markdown` (*that* listing only). Still miss → tell the user and stop — no guessed recall.

4. Read repo `AGENTS.md` (project conventions and constraints).

5. Summarize briefly what is next (from the handoff `## Next` section when present), then stop and wait for the user's go-ahead — do not start acting on `## Next` or anything else unless the user explicitly says so in this session.

The vault is outside the workspace — grant shell permissions if Claude Code prompts you.
Use free-text after `/grounder-recall` as optional focus (session name, index, or task hint).
