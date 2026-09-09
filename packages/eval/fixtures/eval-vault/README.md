# Eval Vault

Fixture vault for `@grounder/eval` (`pnpm eval:search`).

Committed as one project, `10-Projects/eval-search/`, with a seeded `notes/` and `plans/` pair per search probe: one document each probe should rank first, one unrelated distractor. See `../../probes/search-probes.json` for which document each probe expects on top.

Point a sandboxed `~/.grounder/config.json` (`vaultRoot`) at this folder for eval runs — never the real vault. Do not add project folders here beyond `eval-search/`; new probe sets that need seeded content get their own `10-Projects/<id>/`.
