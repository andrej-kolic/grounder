# Grounder

[![npm version](https://img.shields.io/npm/v/grounder.svg)](https://www.npmjs.com/package/grounder)
[![CI](https://github.com/andrej-kolic/grounder/actions/workflows/ci.yml/badge.svg)](https://github.com/andrej-kolic/grounder/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/grounder.svg)](LICENSE)

> **Markdown-native memory shared across AI agents, sessions, and machines.**

AI agents forget everything between sessions and can't share context with each other. **Grounder** fixes this by externalizing agent memory into local files you control (Obsidian-compatible, but never required). Context survives session ends, agent switches, and machine migrations.

### What it is

AI-first CLI and agent command set that:

- **Connects any project** — git repositories or standard folders — to your local vault (multi-project support).
- **Captures state deliberately** — converts a discussion into a living plan, checkpoints a session for handoff, or saves arbitrary notes.
- **Hydrates on demand** — allows you or any agent to resume exactly where a prior session left off without re-deriving context.
- **Works natively today** with Cursor, Claude Code, and standard CLI workflows.

### What it is not

Grounder is **not** an auto-capture or RAG tool, nor does it attempt to record every interaction. There is no vector database, no background indexing, and zero context injection unless explicitly requested. One small, deliberate checkpoint replaces an agent re-deriving context from scratch — using a fraction of the tokens in a file you can diff, edit, or delete.

### Demo

![A session loop: peek teaser, /grounder-task resume, /grounder-plan list, continuing a plan, /grounder-note, /grounder-task-handoff — each with the real grounder CLI call it runs and the vault path it touches](packages/demo-casts/out/readme.gif)

A full session loop, one step at a time:

- **Peek hook** resumes a prior handoff automatically at session start
- **`/grounder-task`** picks up the next step from that handoff
- **`/grounder-plan list`** shows the real plans already sitting in the vault
- Continuing a plan by name — plain chat works too, not just slash commands
- **`/grounder-note`** captures a quick mid-session insight
- **`/grounder-task-handoff`** checkpoints the session on close

Dim lines are the actual `grounder` CLI call each slash command runs under the hood.

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
pnpm grounder vault init <path-to-your-vault> --yes --hooks   # once per machine
cd fixtures/dev
pnpm grounder init --yes
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
