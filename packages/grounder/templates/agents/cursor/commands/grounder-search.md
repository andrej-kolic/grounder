Search this project's vault content for relevant context.

Use this when the user asks to find prior project-vault context by topic, keyword, concept, or phrase.

Scope is this linked project only. Do not search outside the linked project's vault root.

Output contract (default, happy path):
- Do not narrate steps.
- Do not print preflight/status output on success.
- Do not send interim progress updates. Perform preflight/search silently, then send one final response.
- Return only one of these:
  - `results`: mandatory count header + concise ranked matches with short snippets
  - `no-results`: short no-match message (+ optional 2-3 alternate terms)
  - `error`: brief actionable failure message

Before searching:
- Run `{{GROUNDER_CLI}} status`.
- Confirm `Linked: yes`.
- Read `Project Vault Root:` and treat that path as the only search root.
- If not linked (or `Project Vault Root:` is missing), stop and tell the user to run `grounder link` (and `grounder setup <path>` if needed).

1. Reformulate the query into 4-8 practical keyword variants:
   - Keep the original phrase.
   - Add likely synonyms, abbreviations, and singular/plural forms.
   - Include technical nouns the user probably means.
   - Prefer concrete terms over broad words.

2. Search recursively under `Project Vault Root:` with fast text search (match body and frontmatter), combining variants.
   - If needed, run a few targeted searches instead of one huge regex.
   - Capture enough context lines to understand each hit.

3. Deduplicate results:
   - Group repeated hits from the same file.
   - Keep the strongest snippet(s) per file.
   - Prefer files that clearly match intent.

4. Return output in the contract above:
   - `results`: first line must be `Found <matches> matches in <files> files.` then show strongest matches with path + one-line relevance + short evidence snippets.
   - `no-results`: keep it short, include optional alternate terms.
   - `error`: one actionable fix (for example: run `grounder setup <path>` or `grounder link`).

Ranking guidance (when many hits): prefer concise/high-signal docs and break ties by recency.

Run {{GROUNDER_CLI}} with `required_permissions: ["all"]` (vault is outside the workspace).
Do not write to vault files during search.
