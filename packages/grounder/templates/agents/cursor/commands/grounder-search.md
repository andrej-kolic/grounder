Search this project's vault content for relevant context.

Use this when the user asks to find prior project-vault context by topic, keyword, concept, or phrase.

Scope is this linked project only — the CLI resolves and searches under the linked project vault root. Do not search outside it.

## Turn budget (speed)

Exactly **two** tool rounds, then the answer:

1. Shell: one `search … --json` (optional second search only per broaden rule below — still no chat).
2. Reads: **one** parallel batch of full-file reads.
3. Final answer to the user.

**No assistant/user-visible text before step 3.** No status lines, no “I’ll search…”, no triage narration, no debating which hit to open. Tool calls only until the final block.

## Output contract (default — hybrid)

- Do not echo commands or shell output.
- **Never paste CLI JSON, snippets, or raw stdout into chat** — parse `--json` internally only.
- One final synthesized response only.

Structure:

1. **Opening** — one sentence.
2. **Read these** — files you fully read: path + optional role + short bullets.
3. **Also matched** — unread CLI hits: path + one phrase each. Omit if empty.

**Lookup mode:** exact mention / line reference only → relay CLI `--markdown` as-is (one search, no full reads).

## Steps

1. **Terms (private)** — 3–5 short `--terms`:
   - User phrase = `query` only (do not recycle it as a long term).
   - Single tokens or ≤2-word phrases; prefer vault/product language (`slash commands`, `grounder migrate`, `hash drift`).
   - **Include ≥1 concrete identifier** when the topic has one (`commandsSchema`, `hooksSchema`, `state.json`, `chezmoi`, etc.) — do not rely only on soft words like `migrate`.
   - No long paraphrases. No lone generics (`command`, `file`, `update`).
   - **No repo/source paths or module names** as terms (`install-command`, `vault/search.ts`, `packages/…`) unless the user explicitly asked about code layout.

2. **Search (tool round 1):**

```bash
{{GROUNDER_CLI}} search "<query>" --terms "<csv>" --context 2 --json
```

**Always quote `--terms`.** Unquoted CSV with spaces corrupts argv.

Parse JSON privately. Take `hits[].file` in CLI order.

**Broaden once (silent)** only if `totalFileCount` is 0, or ≤2 and every hit is meta (`discussions/search/`, or snippet only quotes the query). Otherwise do not re-search.

3. **Read (tool round 2)** — mandatory unless lookup:
   - Full-read CLI hits **1–4** in rank order, **all in one parallel batch**.
   - **No skips, no substitutions, no “maybe also hit 5.”** Trust CLI order; judge relevance only when writing the answer.
   - Request vault read permissions as needed.

4. **Answer** — synthesize immediately after reads:
   - Claims only from file content.
   - Useful full reads → **Read these** (thin/off-topic reads get one blunt line there or drop to **Also matched**).
   - Remaining top-10 CLI hits you did not deep-summarize → **Also matched** (one phrase from snippet/path).
   - Prefer design/archive docs when they are the authority.

Run from the linked project folder or any subdirectory beneath it.
Run {{GROUNDER_CLI}} with `required_permissions: ["all"]` (vault is outside the workspace).
Do not write to vault files during search.
Do not grep the vault yourself — the CLI ranks; you read and synthesize.
