# Phase 2 bugfix — status

Shipped on `handoff` (fixes as separate commits). Ship blockers and suggested P0–P2 items are done.

## Fixed

1. **Newest-first sort** — always `YYYY-MM-DD-HHmmss`; collisions use `_NN` (`_` sorts after `.`)
2. **Detached HEAD** — `currentBranch` maps `HEAD` → `undefined` (omit `branch:`)
3. **Exclusive create** — `wx` + EEXIST retry for handoffs and notes
4. **YAML frontmatter** — double-quoted escaped scalars
5. **Heredoc templates** — unindented body in code fence; `handoff list` rejects unexpected positionals
6. **`--limit` hygiene** — require positive integer; reject unknown flags / bare `--limit`

## Deliberately not fixed

| Item | Why |
| --- | --- |
| Local filename vs UTC `created` | Intentional: sortable local names vs portable ISO |
| Filter non-handoff `*.md` in `logs/` | Convention (`logs/` = handoffs only); frontmatter filter risks false negatives |
| Rename `handoff list` subcommand | CLI redesign, not an edge-case patch |

## Doc drift

Phase 2 plan naming examples updated to match implementation (`HHmmss` + `_NN`).
