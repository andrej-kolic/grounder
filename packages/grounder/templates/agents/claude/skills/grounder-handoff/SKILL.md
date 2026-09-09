---
name: grounder-handoff
description: Write a session handoff checkpoint to the markdown vault for this project.
disable-model-invocation: true
---

Write a session handoff checkpoint to the markdown vault for this project.

**Mode lock — write only.**
- Never hydrate or start work, regardless of typed extra text (resume / load / hydrate / `/grounder-recall`) — never run `{{GROUNDER_CLI}} handoff list` to pick or overwrite an existing file; always write a **new** file. Still do this command's job, then add one sentence: saved — run `/grounder-recall` in a new chat to resume. Skip that sentence for "continue in a new session" wording (that's the point of saving) or when the mention only appears in stale payload text.
- Typed extra text is only what the user wrote after `/grounder-handoff` in the chat line — empty or bare command means no extra instruction; ignore any sibling verb that shows up only in a leftover command-payload wrapper. Otherwise, extra text is body guidance for this handoff.
- `#N` here means leftover Next item N from *this* session, not file N in a listing.

Summarize the session into a structured handoff — not a chat transcript.
Do not dump tool traces, full conversation, or false starts.

Build a markdown body with these sections (lean; roughly half a screen to one screen):

```markdown
# Handoff: <short label>

## Done
- …

## Next
1. …   # ordered; most important section for resume — required
2. …

## Blockers
- None | …

## Decisions
- …    # include rejected alternatives / pitfalls when useful

## Files
- path/to/relevant.ts
```

Rules:
- **Next is mandatory and ordered** — if only one section is read, this is it
- Empty sections are OK (`Blockers: None` beats omission)
- Few concrete file paths, not an exhaustive diff
- If a vault plan (`grounder plan`) or ticket drove the session, list it first in `## Files` with a short note on what changed — e.g. `path/to/plan.md (Status section updated)`, `#123 (new ticket filed)`

Then run from the linked project folder or any subdirectory beneath it:

  {{GROUNDER_CLI}} handoff "<body>"

Optional short title slug (filename + frontmatter):

  {{GROUNDER_CLI}} handoff --title <slug> "<body>"

Always include `--topics` with 3-5 comma-separated lowercase keywords that capture the session's core concepts (e.g. `--topics "auth,middleware,jwt,session"`). Pick terms a future search would use — concrete nouns and technical terms, not verbs or filler:

  {{GROUNDER_CLI}} handoff --topics "keyword1,keyword2,keyword3" "<body>"

For multi-line bodies, prefer a shell heredoc so quoting does not break:

```bash
{{GROUNDER_CLI}} handoff "$(cat <<'EOF'
# Handoff: …
…
EOF
)"
```

The vault is outside the workspace — grant shell permissions if Claude Code prompts you.

Do not compute vault paths or write files yourself — the CLI handles it.
Report the CLI output path from stdout to the user.
