Write a named, updatable plan document to the Obsidian vault for this project.

Distill the instruction after `/grounder-plan` into a structured plan — not a chat transcript.
Do not dump tool traces, full conversation, or false starts.

Build a markdown body with these sections:

```markdown
# Plan: <title>

## Goal
…

## Steps
1. …
2. …

## Decisions / open questions
- …

## Status
…
```

Choose create vs update:

**Update when you already know the plan’s vault path** (attached/open in context): use `--path` with that exact path. Do not invent or sanitize a `--title`.

```bash
{{GROUNDER_CLI}} plan "$(cat <<'EOF'
# Plan: …
…
EOF
)" --path <absolute-or-relative-path-to-existing-plan.md>
```

`--path` must resolve under this project's `plans/` dir. It always overwrites (no `--force`).

**Create a new plan** (or update by explicit name when you do not have the file open):
resolve a filename for `--title`:
- If the instruction names one explicitly (e.g. `save as "implementation-phase-1"` or `…phase-1.md`), use it (strip a trailing `.md`).
- Otherwise derive a short kebab-case name from the plan's title/goal and confirm it with the user before writing.

Then run from the linked project folder or any subdirectory beneath it:

  {{GROUNDER_CLI}} plan "<body>" --title <name>

For multi-line bodies, prefer a shell heredoc so quoting does not break:

```bash
{{GROUNDER_CLI}} plan "$(cat <<'EOF'
# Plan: …
…
EOF
)" --title <name>
```

If the CLI refuses because that name already exists (non-zero exit; stderr names the conflict), tell the user and ask whether to overwrite (`--force`) or pick a different name. **Never** silently pass `--force`.

The vault is outside the workspace — grant shell permissions if Claude Code prompts you.

Do not compute vault paths or write files yourself — the CLI handles it.
Report the CLI output path from stdout to the user.
