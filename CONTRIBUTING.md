# Contributing to Grounder

This repo is the monorepo that publishes the [`grounder`](packages/grounder) npm package.
[AGENTS.md](AGENTS.md) is the detailed source map; this file covers the workflow.

## Layout

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
├── docs/                  # user docs + docs/architecture/ design notes
└── AGENTS.md              # repo map for agents / contributors
```

## Development

```bash
pnpm install
pnpm check                 # build + typecheck + lint + test
pnpm grounder --version    # run local CLI (build first)
```

Root scripts are the quality contract — call these entrypoints rather than ad-hoc tool
invocations. Run `pnpm check` before opening a PR.

## Try the CLI locally

Use `fixtures/dev/` as a workspace sandbox (not the test fixture):

```bash
pnpm fixture:setup
pnpm grounder setup <path-to-your-vault> --yes --hooks   # once per machine
cd fixtures/dev
pnpm grounder link --yes
pnpm grounder note "hello from dev fixture"
```

Session loop in the agent: (optional teaser on session start) → `/grounder-task` → work →
`/grounder-task-handoff`.

More commands and dogfooding tips: [fixtures/dev/README.md](fixtures/dev/README.md).

## Architecture

Agent-agnostic core (`connector/`, `vault/`, `commands/`) plus a pluggable `agents/`
adapter registry for Cursor, Claude Code, and future targets. Templates live in
`packages/grounder/templates/agents/{id}/`, so adding an agent means one adapter file plus
one template directory.

Design notes (not user how-tos):

- [Schema versioning and install migration](docs/architecture/schema-versioning.md) — `state.json`, hash drift, `grounder migrate`, forward-compat
- [Runtime invocation](docs/architecture/runtime-invocation.md) — baked Node + `~/.grounder/runtime`, doctor dangling-interpreter check
- [Vault search](docs/architecture/vault-search.md) — how `grounder search` scans and ranks

## Docs

User-facing docs live in [`docs/`](docs/README.md). Keep the README a front door: anything
past the first successful run (full flag tables, configuration, upgrade mechanics,
troubleshooting) belongs in `docs/`.

The root README is canonical. [`packages/grounder/README.md`](packages/grounder/README.md)
is the npm-facing subset and must use **absolute** URLs for images and links, since
relative paths break outside the published tarball.

## Publish

Only `packages/grounder` is published to npm. Releases are tag-driven via GitHub Actions
(OIDC trusted publishing) — do not publish from a laptop for steady-state releases.

1. Ensure `main` is green.
2. Bump `version` in `packages/grounder/package.json` and merge to `main`.
3. Tag and push (tag must match the package version, e.g. `0.1.0` → `v0.1.0`):

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

4. Watch the [Release](https://github.com/andrej-kolic/grounder/actions/workflows/release.yml)
   workflow — it runs `pnpm check`, publishes to npm, and creates a GitHub Release.

## Demo GIF

The README GIF is generated from hand-authored scene scripts in
[`packages/demo-casts`](packages/demo-casts/README.md):

```bash
pnpm demo:cast
```

Requires [`agg`](https://github.com/asciinema/agg) on `PATH`. Not part of `pnpm check`.
