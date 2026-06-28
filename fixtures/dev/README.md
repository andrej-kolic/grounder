# Dev fixture

Local playground for manually trying the Grounder CLI inside the monorepo.

Unlike `fixtures/minimal-git-repo/` (a stable test fixture), this folder is for your own dogfooding. Local state is gitignored: `.grounder.json`.

## Setup

From the monorepo root:

```bash
pnpm fixture:setup
pnpm grounder vault init ~/Documents/obsidian/dev --yes   # once per machine
cd fixtures/dev
pnpm grounder init --yes
pnpm grounder note "hello from dev fixture"
```

Project id comes from `package.json` → **`grounder-dev`**. Notes land in:

`<vault>/10-Projects/grounder-dev/notes/`

Run `init` from this folder — it writes `.grounder.json` here (not at the monorepo root). Run `note` from here or any subfolder; the CLI walks up to find the marker. The `grounder` CLI is a workspace dependency (`workspace:*`).

After editing `packages/grounder/src`, run `pnpm build` from the repo root — the bin runs `dist/cli.js`.

`/grounder-note` in Cursor uses `npx grounder note` (works with the workspace link). Re-install the slash command after template changes:

```bash
pnpm grounder vault init ~/Documents/obsidian/dev --force --yes
```
