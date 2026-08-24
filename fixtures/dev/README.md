# Dev fixture

Local playground for manually trying the Grounder CLI inside the monorepo.

Unlike `fixtures/minimal-git-repo/` (a stable test fixture), this folder is for your own dogfooding. Local state is gitignored: `.grounder.json`.

## Setup

From the monorepo root:

```bash
pnpm fixture:setup
pnpm grounder setup <path-to-your-vault> --yes --hooks   # once per machine
cd fixtures/dev
pnpm grounder link --yes
pnpm grounder note "hello from dev fixture"
```

Project id comes from `package.json` → **`grounder-dev`**. Paths:

```text
<vault>/10-Projects/grounder-dev/notes/
<vault>/10-Projects/grounder-dev/logs/
<vault>/10-Projects/grounder-dev/plans/
```

Run `link` from this folder — it writes `.grounder.json` here (not at the monorepo root). Run `note` / `handoff` / `plan` from here or any subfolder; the CLI walks up to find the marker. The `grounder` CLI is a workspace dependency (`workspace:*`).

After editing `packages/grounder/src`, run `pnpm build` from the repo root — the bin runs `dist/cli.js`.

Both slash commands and (with `--hooks`) session-start hooks run through `~/.grounder/runtime/dist/cli.js`, never `npx`. Because `pnpm grounder` here runs straight from this checkout (`node packages/grounder/dist/cli.js`), `setup` **symlinks** `~/.grounder/runtime/dist` to this checkout's `dist/` — after that one-time run, `pnpm build` alone keeps slash commands *and* hooks current. No need to re-run `setup` after every change, and no risk of them silently running a different (published) version — see the [Session-start hooks](../../packages/grounder/README.md#session-start-hooks) section of `packages/grounder/README.md` for the symlink/copy mechanism.

## Session handoff loop

```bash
# Close a session — structured checkpoint (not a chat dump)
pnpm grounder handoff "$(cat <<'EOF'
# Handoff: phase-2 dogfood

## Done
- Linked fixtures/dev and wrote a note

## Next
1. Open a new chat and run /grounder-task

## Blockers
- None

## Decisions
- Newest log file wins on resume

## Files
- fixtures/dev/README.md
EOF
)" --title phase-2-dogfood

pnpm grounder handoff list
pnpm grounder path logs

# Named living plan (update in place with --force)
pnpm grounder plan "$(cat <<'EOF'
# Plan: phase-2 dogfood

## Goal
Exercise named plans in the dev fixture

## Steps
1. Write this plan
2. Re-run with --force after changes

## Decisions / open questions
- None

## Status
Draft
EOF
)" --title phase-2

pnpm grounder path plans
```

In Cursor / Claude Code (from this folder or a linked project):

```text
(new session)           → optional one-line teaser if a handoff exists (with --hooks)
/grounder-task          → list --head + read newest usable handoff + AGENTS.md (read-only)
… work …
/grounder-task-handoff  → summarize → runtime handoff "<body>"
/grounder-plan          → write/update named plan → runtime plan "<body>" --title <name>
```

Verify the teaser without starting an agent session:

```bash
pnpm grounder handoff peek          # linked + handoff → one line; else silent
```

The teaser never auto-loads the full handoff and never blocks a session — run `/grounder-task` only when you want the body.

All four slash commands run through the symlinked runtime described above, so they always exercise this checkout's build — `pnpm build` after editing `src/` is enough; no re-run of `setup` needed to pick up code changes. Re-run only after editing **templates** (`templates/agents/*/commands/*.md`), since template content is copied at install time:

```bash
pnpm grounder setup <path-to-your-vault> --force --yes --hooks
# or pin agents: --agent=cursor --agent=claude
```
