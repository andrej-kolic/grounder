# empty-workspace

Deliberately unlinked (no `.grounder.json`) folder opened by the `activation` test config.
Keeps that smoke test independent of any real vault fixture. Configs that need real vault
content (`tree`, `multiroot`) build their fixtures at runtime instead, in `.vscode-test.mjs`, via
the actual CLI's `setup`/`link` against a fresh OS temp dir — not checked in here.
