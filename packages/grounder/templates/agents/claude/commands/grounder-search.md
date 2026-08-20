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

**Path links (mandatory for every listed file):**
- Visible title = vault-relative path (under the project vault root).
- Link target = `file://` URL from the absolute `hits[].file` (same idea as CLI `--markdown`).
- Percent-encode spaces in the URL (`0.2.0%20and%20older`), not in the visible title.
- Markdown form: `[plans/archive/…/doc.md](file:///absolute/path/to/doc.md)`

**Numbering (mandatory):**
- Number every listed file, continuing across sections (`1…` in **Read these**, then `5…` in **Also matched`).
- Do not restart at 1 in **Also matched**. Do not use bullet-only lists without numbers.

Structure:

1. **Opening** — one sentence of what the vault says (not a search recap).
2. **Read these** — hits 1–4 only; numbered linked paths + optional role + short bullets under each. You may list a design/archive authority first *among those four*.
3. **Also matched** — leftover top-10 **in CLI order** (do not reshuffle); numbered linked paths + one short phrase each. Omit if empty.

Example shape:

```markdown
Vault notes discuss … 

## Read these
1. [plans/archive/0.3.0/schema_….md](file:///…/schema_….md) — design authority
   - …
2. [plans/…](file:///…) — …
## Also matched
3. [plans/…](file:///…) — one phrase
4. [plans/…](file:///…) — one phrase
```

**Lookup mode:** exact mention / line reference only → relay CLI `--markdown` as-is (one search, no full reads).

## Steps

1. **Query and terms (private)** — the CLI line-scans `--terms`. `query` is a scan term only when it is 1–2 words; longer queries only boost a file if that **exact** phrase appears (rare). Rank is dominated by how many distinct terms hit the **same** file — complementary vault words beat extra English synonyms and source module names.

   **Query** = topic only:
   - Strip retrieval wrappers (`find`, `search for`, `documents discussing`, `notes about`, `look up`).
   - Do not pass the whole utterance.
   - Do not recycle the query as a `--terms` item.

   **Terms** — fill 3–5 slots, then stop:
   1. Product noun/phrase from the topic (`slash commands`)
   2. Product verb or CLI name if the topic has one (`grounder migrate` — never the lone generic `migrate`)
   3. One on-disk identifier (`commandsSchema`, `hooksSchema`, `state.json`, `hash drift`, `chezmoi`)
   4–5. Only another vault/product token. No paraphrase of the query.

   **Never as terms** (unless the user asked about code layout): repo paths, `packages/…`, source module names (`install-command`, `vault/search.ts`).

   Example — user: `find documents discussing handling migrations of slash commands`
   - query: `handling migrations of slash commands`
   - terms: `slash commands,grounder migrate,hash drift,commandsSchema,state.json`
   - not: `install-command`, `migrate`, `find documents`

2. **Search (tool round 1):**

```bash
{{GROUNDER_CLI}} search "<query>" --terms "<csv>" --context 2 --json
```

**Always quote `--terms`.** Unquoted CSV with spaces corrupts argv.

Parse JSON privately. Take `hits[].file` in CLI order. Use `hits[].matches[].term` (and `topicsMatch`) only to phrase Also matched / roles — do not quote snippets.

**Broaden once (silent)** only if `totalFileCount` is 0, or ≤2 and every hit is meta (`discussions/search/`, or snippet only quotes the query). Otherwise do not re-search.

3. **Read (tool round 2)** — mandatory unless lookup:
   - Full-read CLI hits **1–4** in rank order, **all in one parallel batch**.
   - **No skips, no substitutions, no “maybe also hit 5.”** Trust CLI order; judge relevance only when writing the answer.
   - Grant read permissions for vault paths outside the workspace when needed.

4. **Answer** — synthesize immediately after reads:
   - Claims only from files you full-read. Unread hits must not grow new facts.
   - **Read these:** useful full-reads (those 1–4 only). Thin/off-topic reads get one blunt numbered line there or move to **Also matched**.
   - **Also matched:** remaining top-10 you did not deep-summarize, **in CLI leftover order**. One short phrase each — from the path stem or JSON `matches[].term`, not a sentence and not a guess from an unrelated filename.
   - Every file line uses the numbered `file://` form above; continue numbering across sections.
   - Prefer design/archive docs when they are the authority among the files you read.

Run from the linked project folder or any subdirectory beneath it.
The vault is outside the workspace — grant shell permissions if Claude Code prompts you.
Do not write to vault files during search.
Do not grep the vault yourself — the CLI ranks; you read and synthesize.
