Save a note to the Obsidian vault for this project.

Distill the instruction after `/grounder-note` into a clean note body — not a chat transcript.
Do not dump tool traces, full conversation, or false starts.

**Special case: the instruction asks to view existing notes, not write one** (`list`, `list 3 oldest`, `show notes`, etc.) → run `{{GROUNDER_CLI}} note list --limit <N>` (N = count named, else 5; ignore order words like "oldest" — output is always newest-first, never resort or relabel it) and stop — no note write. Relay the CLI stdout as-is (it already includes the count header).

Rules:
- Default → distill the args into a clean note body
- Exact wording marked to keep (quoted, "save exactly:"/"verbatim:", or a fenced block) → use that verbatim instead, unmodified
- Empty args → distill the central point of the current thread instead

Then run from the linked project folder or any subdirectory beneath it:

  {{GROUNDER_CLI}} note "<body>"

Optional short title slug (filename):

  {{GROUNDER_CLI}} note --title <slug> "<body>"

For multi-line bodies, prefer a shell heredoc so quoting does not break:

```bash
{{GROUNDER_CLI}} note "$(cat <<'EOF'
…
EOF
)"
```

The vault is outside the workspace — grant shell permissions if Claude Code prompts you.

Do not compute vault paths or write files yourself — the CLI handles it.
Report the CLI output path from stdout to the user.
