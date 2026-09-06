---
name: grounder-search
description: Search this project's vault content for relevant context.
disable-model-invocation: true
---

Search this project's vault content for relevant context.

**Silence:** write **no assistant text** until step 3. Rounds 1–2 are tool calls with an empty/absent text part — not “I’ll search…”, not “I’ll read…”, not “**Analyzing…**”, not query/terms narration.

Use this when the user asks to find prior project-vault context by topic, keyword, concept, or phrase.

Scope is this linked project only — the CLI resolves and searches under the linked project vault root. Do not search outside it.

## Turn budget (speed)

**Rounds 1–2: tool calls only — no text part in those messages.** Not even one sentence.

Exactly **two** assistant turns with tools, then the answer. Allowed tools, nothing else:

1. Round 1 — Shell only: one `search … --json` (optional second search in the *same* round only per the broaden rule below). Message = that tool call, nothing else.
2. Round 2 — Read only: **one** parallel batch of full-file reads (hits 1–4). Message = those Read calls, nothing else.
3. Final answer to the user (first and only chat text).

**Do not** Glob, Grep, extra Shell, or status/UI tools (`UpdateCurrentStep`, `TodoWrite`, and similar). Do not add a third tool turn. Do not explore the repo.

## Output contract (default — hybrid)

- Do not echo commands or shell output.
- **Never paste CLI JSON, snippets, or raw stdout into chat** — parse `--json` internally only.
- One final synthesized response only.

**Path links (mandatory for every listed file):**
- Visible title = `hits[].relativePath` from JSON **exactly** (project-vault-relative; the folder that contains `notes/`, `logs/`, and `plans/`). Example: `plans/archive/0.2.0 and older/doc.md`.
- **Do not** derive the title from `hits[].file`, path segments, or parent-vault prefixes.
- **Wrong titles:** `10-Projects/grounder/plans/…`, `%20` in the visible title, or any path above the project vault root.
- Link href = `hits[].fileUri` from JSON (spaces already percent-encoded).
- Markdown form: `[hits[i].relativePath](hits[i].fileUri)`

**Numbering (mandatory):**
- Number every listed file, continuing across sections (`1…` in **Read these**, then `5…` in **Also matched`).
- Do not restart at 1 in **Also matched**. Do not use bullet-only lists without numbers.

**Zero-hit disclosure (mandatory, both modes):** if `totalFileCount` is 0 (after the broaden attempt for topic/request), answer exactly `No matches in [<vaultRoot>](<vaultRootUri>) for this topic.` (`vaultRoot`/`vaultRootUri` from the JSON payload — the vault folder actually searched) instead of the Structure below.

Structure (non-empty results):

1. **Opening** — one sentence of what the vault says (not a search recap). Never start with “I have searched…”, “I found…”, or similar.
2. **Read these** — hits 1–4 only; numbered linked paths + optional role + short bullets under each. You may list a design/archive authority first *among those four*.
3. **Also matched** — leftover top-10 **in CLI order** (do not reshuffle); numbered linked paths + one short phrase each (`hits[].alsoMatchedHint` or `matches[].term`). Every line must end with ` — phrase`; bare links are invalid. Omit if empty.

Example shape (`##` headings required — not bold-only, not `###`):

```markdown
Vault notes discuss …

## Read these
1. [plans/archive/0.3.0/schema_….md](file:///…/schema_….md) — design authority
   - …
2. [plans/…](file:///…) — …
## Also matched
3. [plans/archive/0.2.0 and older/doc.md](file:///…/0.2.0%20and%20older/doc.md) — one phrase
4. [plans/…](file:///…) — one phrase
```

**Lookup mode:** explicit lookup wording (`exact phrase`, `this line`, `the wording`) **or** the entire input after stripping retrieval wrappers is a bare `"quoted span"` → one search with `--json` (no `--terms`, no full reads). Non-empty: list each hit as `[relativePath](fileUri)` (Path links rules) followed by its `matches[]` lines (`L{line} ({term}): {snippet}`), CLI order, no synthesis. Empty: Zero-hit disclosure.

## Steps

1. **Query and terms (private)** — classify, then build argv. Classification is silent (no chat text). The CLI always line-scans `query` plus `--terms`. Multi-word queries only match lines that contain that phrase verbatim. Rank is dominated by how many distinct terms hit the **same** file — complementary vault words beat extra English synonyms and source module names.

   **Classify** after stripping retrieval wrappers (`find`, `search for`, `documents discussing`, `notes about`, `look up`). Then pick one:

   - **Lookup** — explicit lookup wording (`exact phrase`, `this line`, `the wording`), **or** leftover is a bare `"quoted span"`. `query` = the quoted text, unmodified — execution: see **Lookup mode** above.
   - **Request** — leftover still has request syntax (any of): `that mention` / `that discuss` / `that talk about`; leftover starts with `plans that` / `notes that` / `docs that` / `documents that`; trailing scope `both in` / `either in` / `in CLI and`. Do **not** pass that leftover as `query`. `query` = one primary noun or named command from the topic (tight phrase; do not prefix a product name). Extra nouns go in `--terms`.
   - **Topic leftover** — leftover is already a topic noun-phrase. `query` = leftover, same words, same order. Do not paraphrase, shorten, or coin a new phrase.

   Strip only retrieval wrappers. Do not pass the whole utterance. Do not recycle the query as a `--terms` item.

   Examples below are a **fictional** domain. Copy the shape; invent tokens for *this* topic. Do not reuse these strings as `--terms`.

   Example — lookup. User: `find "retry of expired jobs"`
   - class: lookup
   - argv: {{GROUNDER_CLI}} search "retry of expired jobs" --json

   Example — topic leftover. User: `find documents discussing retry of expired jobs`
   - class: topic leftover
   - query: `retry of expired jobs` (leftover after stripping the wrapper)
   - wrong query: `expired job retries` (rewritten)
   - wrong class: request (`documents discussing` is a wrapper)

   Example — request. User: `find plans that mention updating the charge or refund command, both in worker and API`
   - class: request (`plans that mention` / `both in` stay leftover — not the topic)
   - query: `charge` (one named command from leftover; not `billing charge`)
   - terms: `refund,settlement,invoices.json,RefundPolicy`
     - from leftover: `refund` (the other named command)
     - invented: `settlement` (domain), `invoices.json` (file), `RefundPolicy` (schema) — guess this project's equivalents
   - wrong query: `plans that mention updating the charge or refund command, both in worker and API`
   - wrong query: `charge refund command` (joined nouns)
   - not as terms: `plan`, `command`, `api`

   **Terms** — invent 3–5 complementary vault tokens for *this* topic, then stop. They need not appear in the utterance:
   1. Domain noun/phrase from the topic (skip if it would duplicate the query)
   2. Named command or product verb if the topic has one — never a lone generic verb (`migrate`, `install`)
   3. One on-disk identifier (filename, config key, schema field) guessed for this project
   4–5. Only another vault/product token. No paraphrase of the query.

   **Never as terms** (unless the user asked about code layout): repo paths, `packages/…`, source module / file stems. Lone high-df words (`plan`, `command`, `cli`) flatten rank. Prefer words that appear in vault notes (named commands, config files, domain identifiers).

   Example — user: `look up why the retry queue must skip expired jobs`
   - class: topic leftover
   - query: `why the retry queue must skip expired jobs`
   - terms: `retry queue,dead letter,jobs.json,RetryPolicy,ttl` (`retry queue` from leftover; others invented)
   - not: `queue-worker`, `process-jobs`, `skip`, `look up`

2. **Search (tool round 1):**

```bash
{{GROUNDER_CLI}} search "<query>" --terms "<csv>" --context 2 --json
```

**Always quote `--terms`.** Unquoted CSV with spaces corrupts argv.

Parse JSON privately. Take hits in CLI order (`hits[0]` …). For links use `relativePath` + `fileUri`; for Also matched gloss use `alsoMatchedHint` or `matches[].term` — do not quote snippets.

**Broaden once (silent)** only if: `totalFileCount` is 0; or ≤2 and every hit is meta (`discussions/search/`, or snippet only quotes the query); or any term in `termHitCounts` has a count of 0 (that term produced no files — it was a bad guess and must be replaced). Otherwise do not re-search.

   Broaden call (use `--context 3` — weaker matches need more context):

```bash
{{GROUNDER_CLI}} search "<query>" --terms "<csv-with-replacement>" --context 3 --json
```

   **Broaden strategy (deterministic):** check `termHitCounts` first — if any term has count 0, replace **that term** (not slot-3) with a different product/vault token. If no zero-hit term, drop slot-3 (the on-disk identifier). Keep slots 1–2 (product noun/verb) unchanged. Do not invent new terms or rewrite existing ones.

3. **Read (tool round 2)** — mandatory unless lookup:
   - Full-read CLI hits **1–4** in rank order, **all in one parallel batch**.
   - Read path = `hits[i].file` (absolute). Link title/href = `hits[i].relativePath` + `hits[i].fileUri`.
   - **No skips, no substitutions, no “maybe also hit 5.”** Trust CLI order; judge relevance only when writing the answer.
   - Request vault read permissions as needed.

4. **Answer** — synthesize immediately after reads:
   - Claims only from files you full-read. Unread hits must not grow new facts.
   - **Read these:** useful full-reads (those 1–4 only). Thin/off-topic reads get one blunt numbered line there or move to **Also matched**.
   - **Also matched:** remaining top-10 you did not deep-summarize, **in CLI leftover order**. Copy `alsoMatchedHint` or phrase from `matches[].term`; every line ends with ` — phrase`.
   - Every file line: `[relativePath](fileUri)` from JSON; continue numbering across sections.
   - Prefer design/archive docs when they are the authority among the files you read.

Run from the linked project folder or any subdirectory beneath it.
Run {{GROUNDER_CLI}} with `required_permissions: ["all"]` (vault is outside the workspace).
Do not write to vault files during search.
Do not grep the vault yourself — the CLI ranks; you read and synthesize.
