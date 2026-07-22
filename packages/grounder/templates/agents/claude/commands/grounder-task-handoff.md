Write a session handoff checkpoint to the Obsidian vault for this project.

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

  npx grounder handoff "<body>"

Optional short title slug (filename + frontmatter):

  npx grounder handoff --title <slug> "<body>"

For multi-line bodies, prefer a shell heredoc so quoting does not break:

  npx grounder handoff "$(cat <<'EOF'
  # Handoff: …
  …
  EOF
  )"

The vault is outside the workspace — grant shell permissions if Claude Code prompts you.

Do not compute vault paths or write files yourself — the CLI handles it.
Report the CLI output path from stdout to the user.
