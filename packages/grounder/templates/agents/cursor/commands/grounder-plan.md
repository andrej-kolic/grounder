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

Resolve the target, then **state it plainly before writing** — `Updating plan at <path>.` or `Creating new plan titled <title>.` This is a visible record, not a blocking confirmation — updates overwrite with no `--force`, so get the match right.

**1. Known path** (attached/open in chat, or printed by an earlier `grounder plan` this conversation) → update it directly.

**2. No path, but update intent** (e.g. "update/continue/revise the plan", or a name that sounds like an existing one) → look it up first:

```bash
{{GROUNDER_CLI}} plan list --limit 5
```

A match counts only if its title actually corresponds to what the user named — not just "it's the only plan in the project." No name given and exactly one plan exists → that counts too. Otherwise (no match, several matches, or a name that doesn't correspond to any existing plan) → ask; never guess.

**3. No path, no update intent → genuinely new plan.** Derive a `--title` (the user's explicit name, else a short kebab-case slug from the plan's title/goal) and write immediately — don't ask about the name itself.

```bash
{{GROUNDER_CLI}} plan "$(cat <<'EOF'
# Plan: …
…
EOF
)" --path <path>   # case 1/2 — update
# or
{{GROUNDER_CLI}} plan "$(cat <<'EOF'
# Plan: …
…
EOF
)" --title <name>  # case 3 — create
```

`--path` must resolve under this project's `plans/` dir. If `--title` collides with an existing plan (non-zero exit; stderr names the conflict), ask: overwrite (`--force`) or a different name. `--force` only resolves that collision — **never** use it to update a plan you meant to target with `--path`.

Run from the linked project folder or any subdirectory beneath it.
Run {{GROUNDER_CLI}} with `required_permissions: ["all"]` (vault is outside the workspace).

Do not compute vault paths or write files yourself — the CLI handles it.
Report the exact path the CLI prints on stdout — it confirms the real outcome, not just the intent.
