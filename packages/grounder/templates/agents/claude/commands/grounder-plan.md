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

Update vs create — never guess a `--title` for an update:

**1. Path known** (attached/open in chat, or printed by an earlier `grounder plan` this conversation): update that exact file.

```bash
{{GROUNDER_CLI}} plan "$(cat <<'EOF'
# Plan: …
…
EOF
)" --path <path-to-existing-plan.md>
```

`--path` must resolve under this project's `plans/` dir; it always overwrites (no `--force`).

**2. Path unknown** (e.g. "update the plan" with nothing attached and no prior path this conversation): look it up, then update as in (1).

```bash
{{GROUNDER_CLI}} plan list --limit 5
```

Pick the path matching the user's intent; ask if none or several match.

**3. Genuinely new plan** (not an update): derive a `--title`.
- If the instruction names one explicitly (e.g. `save as "implementation-phase-1"` or `…phase-1.md`), use it (strip a trailing `.md`).
- Otherwise derive a short kebab-case name from the plan's title/goal and confirm it with the user before writing.

```bash
{{GROUNDER_CLI}} plan "$(cat <<'EOF'
# Plan: …
…
EOF
)" --title <name>
```

If the CLI refuses because that name already exists (non-zero exit; stderr names the conflict), tell the user and ask whether to overwrite (`--force`) or pick a different name. `--force` only resolves this title collision — it is never how you update a plan you already meant to target (use `--path` for that). **Never** silently pass `--force`.

Run from the linked project folder or any subdirectory beneath it.
The vault is outside the workspace — grant shell permissions if Claude Code prompts you.

Do not compute vault paths or write files yourself — the CLI handles it.
Report the CLI output path from stdout to the user.
