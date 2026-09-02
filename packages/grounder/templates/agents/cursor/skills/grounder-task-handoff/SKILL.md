---
name: grounder-task-handoff
description: Write a session handoff checkpoint to the markdown vault for this project.
disable-model-invocation: true
---

Write a session handoff checkpoint to the markdown vault for this project.

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

Run {{GROUNDER_CLI}} with `required_permissions: ["all"]` (vault is outside the workspace).

Do not compute vault paths or write files yourself — the CLI handles it.
Report the CLI output path from stdout to the user.
