# `@grounder/demo-casts`

Private workspace package that compiles hand-authored terminal scene scripts into asciicast + animated GIF assets for the Grounder README (and future docs/site packages).

**Not published to npm.** Consume via `workspace:*` as a `devDependency`, or reference committed files under `out/` with a relative path.

## Layout

```text
scenes/     # hand-authored step scripts (typed/output/wait)
scripts/    # synthetic cast generator + agg render pipeline
out/        # committed artifacts (.cast + .gif) — see out/README.md
```

## Scripts

| Script   | Purpose                                      |
| -------- | -------------------------------------------- |
| `build`  | Compile scenes → `out/<name>.cast` + `.gif`  |
| `cast`   | Alias for `build`                            |

From the monorepo root (once wired): `pnpm demo:cast`.

## Prerequisites

Rendering GIFs requires [`agg`](https://github.com/asciinema/agg) on `PATH` (e.g. `brew install agg`). The `.cast` files are the canonical source; GIFs are produced from them.

## Consumers

Future docs/site packages should depend on this package as a `workspace:*` devDependency and copy or reference files from `out/` in their build. Do not re-render in those packages — use the committed artifacts.
