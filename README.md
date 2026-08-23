# Grounder

[![npm version](https://img.shields.io/npm/v/grounder.svg)](https://www.npmjs.com/package/grounder)
[![CI](https://github.com/andrej-kolic/grounder/actions/workflows/ci.yml/badge.svg)](https://github.com/andrej-kolic/grounder/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/grounder.svg)](LICENSE)

> **Obsidian vault memory for Cursor and Claude Code.**

**Grounder** connects projects to an Obsidian vault for AI agent memory — session handoffs, plans, and notes in files you own (plain markdown; Obsidian is never required). Context survives session ends, agent switches, and machine migrations. No vectors. No background indexing. Just markdown files, your agents, and your vault.

### Demo

![A session loop: peek teaser, /grounder-task resume, /grounder-plan list, continuing a plan, /grounder-note, /grounder-task-handoff — each with the real grounder CLI call it runs and the vault path it touches](packages/demo-casts/out/readme.gif)

**Link** (once per project) — `notes/`, `plans/`, and `logs/` in your vault.

1. **Store** — `/grounder-plan` writes a living file and keeps it current; `/grounder-note` for a one-off; `/grounder-task-handoff` to checkpoint a session.
2. **Recall** — `/grounder-task` for the last handoff, `/grounder-plan list` to pick a plan into context, `/grounder-search` for anything in the vault. Nothing enters context unless you ask.

Dim lines are the actual `grounder` CLI call each slash command runs under the hood.

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

*`created` and `updated` are different dates — the plan survived a second session. Obsidian renders this frontmatter as Properties.*

### What it is

AI-first CLI and agent command set that:

- **Links any project** — git repositories or standard folders — to your local vault (multi-project support).
- **Captures state deliberately** — converts a discussion into a living plan, checkpoints a session for handoff, or saves arbitrary notes.
- **Resume exactly where you left off** — the agent reads the last checkpoint instead of re-deriving context from scratch.
- **Works natively** with Cursor and Claude Code — more agents on the roadmap.
- **Deliberate, not automatic** — nothing enters context unless you ask. No auto-capture, no RAG.

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
