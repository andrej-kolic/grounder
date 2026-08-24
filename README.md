# Grounder

[![npm version](https://img.shields.io/npm/v/grounder.svg)](https://www.npmjs.com/package/grounder)
[![CI](https://github.com/andrej-kolic/grounder/actions/workflows/ci.yml/badge.svg)](https://github.com/andrej-kolic/grounder/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/grounder.svg)](LICENSE)

> **Obsidian vault memory for Cursor and Claude Code.**

**Grounder** gives your AI agents shared memory: plans, notes, and session handoffs written as plain markdown into a folder you control — an Obsidian vault, or any directory on disk. Because that memory lives in your files instead of a chat history, work started in one agent can be picked up in another, weeks later, on a different machine. No database, no vectors, no background indexing — just files you can read, diff, and delete.

### Demo

![A session loop: peek teaser, /grounder-task resume, /grounder-plan list, continuing a plan, /grounder-note, /grounder-task-handoff — each with the real grounder CLI call it runs and the vault path it touches](packages/demo-casts/out/readme.gif)

Dim lines in the GIF are the real `grounder` CLI call behind each command.

### Slash commands

`grounder link` once per project, then everything runs from your agent's chat:

| Command                  | What it does                                        | CLI it runs                    |
| ------------------------ | --------------------------------------------------- | ------------------------------ |
| `/grounder-task`         | Pick up where the last session stopped              | `grounder handoff list --head` |
| `/grounder-plan`         | Write or update a living plan that spans sessions    | `grounder plan`                |
| `/grounder-search`       | Find prior context anywhere in this project's vault | `grounder search`              |
| `/grounder-note`         | Save a one-off note                                 | `grounder note`                |
| `/grounder-task-handoff` | Checkpoint the session before you close it          | `grounder handoff`             |

### In your vault

```text
10-Projects/your-project/
├── notes/
│   └── 2026-07-21-auth-investigation.md
├── logs/
│   ├── 2026-07-21-091500-auth-middleware.md
│   └── 2026-08-14-103000-auth-middleware.md   ← second session
└── plans/
    └── auth-rewrite.md                        ← living plan
```

The living plan — `plans/auth-rewrite.md`:

```markdown
---
project: "your-project"
created: "2026-07-21T09:15:00Z"
updated: "2026-08-14T10:30:00Z"
topics: ["auth", "middleware", "jwt"]
---

## Goal
Ship the auth rewrite before Q3 cutover.

## Steps
- [x] Map current middleware order
- [ ] Add tests for 401 path
- [ ] Swap in new token validator
```

*`created` and `updated` are different dates — the plan survived a second session, same agent or a different one, same machine or another. Obsidian renders this frontmatter as Properties.*

### Good to know

- **Any project** — a git repo or a plain folder; many projects share one vault.
- **Deliberate, not automatic** — nothing is written or loaded unless you ask. No auto-capture, no RAG.
- **Cursor and Claude Code today** — slash commands for both, more agents on the roadmap.
- **Requirements** — Node.js 18+ and a folder to keep the files in: an existing Obsidian vault, or an empty directory.

## Get started

### npm

```bash
npm install -g grounder
```

Then follow the **[package README](packages/grounder/README.md)** for quickstart, commands, configuration, and troubleshooting.

### Agent skill (install + setup in one shot)

```bash
npx skills add andrej-kolic/grounder --skill grounder-setup -g
```

Adding the skill only loads instructions — it does **nothing** until you ask your agent to run it (e.g. "set up grounder").

Or skip the global install: `npx grounder --help`.

This repo is the monorepo that publishes that package.

## Monorepo layout

```text
grounder/
├── packages/
│   ├── grounder/          # publishable npm package (`grounder`)
│   └── demo-casts/        # generate GIF for READMEs (`pnpm demo:cast`)
├── skills/
│   └── grounder-setup/    # skills.sh listing (`npx skills add …`; not in the npm tarball)
├── fixtures/
│   ├── minimal-git-repo/  # stable test fixture
│   └── dev/               # local CLI sandbox (`pnpm fixture:setup`)
├── docs/architecture/     # contributor design notes
└── AGENTS.md              # repo map for agents / contributors
```

## Development

```bash
pnpm install
pnpm check                 # build + typecheck + lint + test
pnpm grounder --version    # run local CLI (build first)
```

### Try the CLI locally

Use `fixtures/dev/` as a workspace sandbox (not the test fixture):

```bash
pnpm fixture:setup
pnpm grounder setup <path-to-your-vault> --yes --hooks   # once per machine
cd fixtures/dev
pnpm grounder link --yes
pnpm grounder note "hello from dev fixture"
```

Session loop in the agent: (optional teaser on session start) → `/grounder-task` → work → `/grounder-task-handoff`.

More commands and dogfooding tips: [fixtures/dev/README.md](fixtures/dev/README.md).

## Publish

Only `packages/grounder` is published to npm. Releases are tag-driven via GitHub Actions (OIDC trusted publishing) — do not publish from a laptop for steady-state releases.

1. Ensure `main` is green.
2. Bump `version` in `packages/grounder/package.json` and merge to `main`.
3. Tag and push (tag must match the package version, e.g. `0.1.0` → `v0.1.0`):

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

4. Watch the [Release](https://github.com/andrej-kolic/grounder/actions/workflows/release.yml) workflow — it runs `pnpm check`, publishes to npm, and creates a GitHub Release.

## Architecture

Agent-agnostic core (`connector/`, `vault/`, `commands/`) plus a pluggable `agents/` adapter registry for Cursor, Claude Code, and future targets. Templates: `packages/grounder/templates/agents/{id}/`.

Design notes for contributors (not user how-tos):

- [Schema versioning and install migration](docs/architecture/schema-versioning.md) — `state.json`, hash drift, `grounder migrate`, forward-compat
- [Runtime invocation](docs/architecture/runtime-invocation.md) — baked Node + `~/.grounder/runtime`, doctor dangling-interpreter check
