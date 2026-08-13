# `@grounder/demo-casts`

Private workspace package that compiles hand-authored terminal scene scripts into asciicast + animated GIF assets for the Grounder README (and future docs/site packages).

**Not published to npm.** Consume via `workspace:*` as a `devDependency`, or reference committed files under `out/` with a relative path.

## Layout

```text
scenes/     # hand-authored step scripts (*.mjs)
scripts/    # compile.mjs (pure) + cast.mjs (CLI → .cast + agg → .gif)
out/        # committed artifacts (.cast + .gif) — see out/README.md
test/       # node:test unit tests (zero deps)
```

## Scene scripts

Each `scenes/<name>.mjs` default-exports either a steps array or an object:

```js
export default {
  width: 80,
  height: 14,
  cps: 22, // default chars/sec for type steps
  steps: [
    { type: "output", text: "$ " },
    { type: "type", text: "echo hi" }, // optional per-step cps
    { type: "output", text: "\r\nhi\r\n" },
    { type: "wait", seconds: 1 },
  ],
};
```

| Step     | Fields                         | Behavior                                      |
| -------- | ------------------------------ | --------------------------------------------- |
| `type`   | `text`, optional `cps`         | Char-by-char typing at fixed characters/sec   |
| `output` | `text` (ANSI allowed)          | Instant canned terminal output                |
| `wait`   | `seconds`                      | Advance timeline; no bytes emitted            |

`build` compiles each scene to deterministic asciicast v2 JSONL at `out/<name>.cast`, then shells out to `agg` to render `out/<name>.gif`. Both artifacts are written for every scene; the build fails if `agg` is missing or rendering fails.

## Scripts

| Script  | Purpose                                                          |
| ------- | ---------------------------------------------------------------- |
| `build` | Compile `scenes/*.mjs` → `out/<name>.cast` + `out/<name>.gif`    |
| `cast`  | Alias for `build`                                                |
| `test`  | Unit-test the compiler (`node:test`, no deps)                    |

From the monorepo root: `pnpm demo:cast` (not part of `pnpm check`).

## Prerequisites

[`agg`](https://github.com/asciinema/agg) must be on `PATH` (one-time contributor setup):

```bash
brew install agg
# or: cargo install --git https://github.com/asciinema/agg
# or: download a release binary from the repo and put it on PATH
```

`agg` is an external binary — not an npm dependency. The `.cast` files remain the canonical source; GIFs are derived for README/docs embeds.

## Consumers

Future docs/site packages should depend on this package as a `workspace:*` devDependency and copy or reference files from `out/` in their build. Do not re-render in those packages — use the committed artifacts.
