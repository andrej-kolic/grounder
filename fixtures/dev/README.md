# Dev fixture

Local playground for manually trying the Grounder CLI inside the monorepo.

Unlike `fixtures/minimal-git-repo/` (a stable test fixture), this folder is for your own dogfooding. Local state is gitignored: `.grounder.json`.

## Setup

From the monorepo root:

```bash
pnpm fixture:setup
pnpm grounder vault init <path-to-your-vault> --yes --hooks   # once per machine
cd fixtures/dev
pnpm grounder init --yes
pnpm grounder note "hello from dev fixture"
```

Project id comes from `package.json` → **`grounder-dev`**. Paths:

```text
<vault>/10-Projects/grounder-dev/notes/
<vault>/10-Projects/grounder-dev/logs/
```

Run `init` from this folder — it writes `.grounder.json` here (not at the monorepo root). Run `note` / `handoff` from here or any subfolder; the CLI walks up to find the marker. The `grounder` CLI is a workspace dependency (`workspace:*`).

After editing `packages/grounder/src`, run `pnpm build` from the repo root — the bin runs `dist/cli.js`.

`--hooks` installs Cursor/Claude session-start hooks. Because `pnpm grounder` here runs straight from this checkout (`node packages/grounder/dist/cli.js`, no `npx`), `vault init --hooks` **symlinks** `~/.grounder/runtime/dist` to this checkout's `dist/` — after that one-time run, `pnpm build` alone keeps both agents' hooks current. No need to re-run `vault init` after every change.

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
```

In Cursor / Claude Code (from this folder or a linked project):

```text
(new session)           → optional one-line teaser if a handoff exists (with --hooks)
/grounder-task          → list --head + read newest usable handoff + AGENTS.md (read-only)
… work …
/grounder-task-handoff  → summarize → grounder handoff "<body>"
```

Verify the teaser without starting an agent session:

```bash
pnpm grounder handoff peek          # linked + handoff → one line; else silent
```

The teaser never auto-loads the full handoff and never blocks a session — run `/grounder-task` only when you want the body.

`/grounder-note` uses `npx grounder note`. Re-install agent artifacts after template changes:

```bash
pnpm grounder vault init <path-to-your-vault> --force --yes --hooks
# or pin agents: --agent=cursor --agent=claude
```
