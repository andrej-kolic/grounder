---
name: grounder-overview
description: Bird's-eye view of this project's vault — counts and recent titles across notes, handoffs, and plans.
disable-model-invocation: true
---

Bird's-eye view of this project's vault — counts and recent titles across notes, handoffs, and plans.

Read-only — do not write to the vault.

Use this when the user wants an overview, inventory, or "what's in the vault" summary — not a single bucket (use `note list` / `handoff list` / `plan list` for that) and not link/wiring health (that's `grounder status`).

From the linked project folder or any subdirectory beneath it:

{{GROUNDER_CLI}} overview --markdown

Relay the CLI stdout as-is — it already includes a per-bucket count header and clickable `[relativePath](fileUri)` title lines for notes, handoffs, and plans. Do not re-run `note list` / `handoff list` / `plan list` afterward; this single call already covers all three.

Use free-text after `/grounder-overview` as an optional recent-titles-per-bucket count (e.g. "show 5 each" → `--limit 5`); otherwise omit `--limit` and use the CLI default.

Run {{GROUNDER_CLI}} with `required_permissions: ["all"]` (vault is outside the workspace).
