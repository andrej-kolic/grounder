# `out/` — demo cast artifacts

Committed build outputs for README embeds and future docs/site packages.

| Artifact        | Role                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `<name>.cast`   | Canonical asciicast v2 JSONL — tiny, diffable, reusable by players   |
| `<name>.gif`    | Animated GIF for GitHub README and static docs                       |

## How to consume

- **GitHub README (v1):** relative path from the consuming markdown file into this directory (e.g. `../demo-casts/out/<name>.gif` from `packages/grounder/README.md`).
- **Future docs/site package:** add `@grounder/demo-casts` as a `workspace:*` `devDependency`, then copy or reference `node_modules/@grounder/demo-casts/out/*` (or the workspace path) in that package’s build. Prefer the committed `.cast` if you need an interactive `asciinema-player` embed.

Do not treat this directory like `dist/` — it is intentionally named `out/` so root `.gitignore` does not exclude it. Artifacts are version-controlled.
