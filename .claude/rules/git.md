<!-- playbook:git v2 (2026-09-21) -->

# Git Commit Conventions

Governs commit message content and commit granularity — not git safety procedure (destructive operations, when to commit, force-push, `--no-verify`). Claude Code already enforces that; this rule fills the gap for tools that don't.

**Precedence — follow the first that exists:** machine-enforced config (commitlint, a `commit-msg` hook), then a convention the project states for agents (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`), then the defaults below.

**Never infer a convention from `git log`** — a repo that states nothing has not decided. Apply the defaults to new commits and leave existing ones alone; never rewrite or amend them to match.

## Defaults

1. **One logical change per commit** — If you need "and" to describe what a commit does, split it. A commit should be revertible on its own without reverting an unrelated change.
2. **Conventional format**: `type(scope): summary` — `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, etc. Scope is optional; omit it when the change isn't scoped to one area.
3. **Imperative mood, no trailing period** — "Fix the race condition," not "Fixed" or "Fixes." Read the subject as completing "This commit will ___."
4. **Subject ≤ 50 chars, body wrapped at ~72** — a blank line separates them. Skip the body when the subject already says it all.
5. **Why, not what** — the diff already shows what changed; the body earns its place only by saying why (the constraint, the bug, the tradeoff).
6. **Never vague** — "update files," "fix bug," "misc changes" say nothing a person can search for or revert against. Name the actual thing that changed.
