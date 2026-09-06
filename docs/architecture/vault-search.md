# Vault search and `/grounder-search`

How Grounder retrieves prior project-vault context — and why ranking lives in the CLI while the skill only drives it.

User-facing flags live in `grounder search --help`. This doc is for contributors who will change either layer.

## Problem

Agents looking for “what did we already decide about X” used to:

- Grep the git repo and the vault interchangeably
- Rank by recency or by whichever file they opened first
- Paste CLI JSON / snippets into chat
- Spend many tool rounds debating which hit to read

That is slow, model-dependent, and mixes two different trees (source vs vault). Search exists so **one deterministic ranker** picks files, and the agent **reads and synthesizes** a short hybrid answer.

## Two layers (do not collapse them)

| Layer | Job | Must not |
| --- | --- | --- |
| `vault/search.ts` + `commands/search.ts` | Scan `*.md` under the **linked project vault root**, score, print | Guess user intent, paraphrase queries, synthesize prose |
| `/grounder-search` templates | Classify lookup / request / topic leftover, turn that into `query` (+ `--terms` for request/topic leftover), always `--json`, full-read top hits when hybrid, write the answer (or zero-hit disclosure) | Re-rank, grep the vault, explore `packages/…` |

**`--terms` is the only model-dependent input that changes ranking.** Protocol (two rounds, `--json`, numbered `file://` links) is compatible across models. File order is not, unless terms match.

If a future change “fixes ranking” by adding more prose to the skill, you are treating a CLI problem as a prompt problem. If it “fixes synthesis” by making the CLI print an essay, you are treating a prompt problem as a CLI problem.

## Scope

Search is **this linked project only**.

`grounder search` resolves the linked repo, then scans `resolveProjectVaultRoot` — `<vault>/10-Projects/{projectId}/` — recursively for `*.md` (`notes/`, `logs/`, `plans/`, plus anything else under that folder, including `discussions/` and `archive/`).

It does **not** search:

- Sibling projects under `10-Projects/`
- The git working tree
- Installed skill files under `~/.cursor/skills/` / `~/.claude/skills/`

Missing project vault root → exit 1, hint `grounder setup`. Unlinked cwd → `requireLinkedProject` error.

## CLI algorithm

Pure filesystem scan. No index, no extra deps.

### 1. Normalize terms

Inputs: positional `query` + optional `--terms` CSV (comma-split, trimmed).

- Dedup case-insensitively.
- **Always include `query` as a line-scan term** (any length), then append `--terms`. Multi-word queries use substring matching, so they only hit lines that contain the phrase verbatim — useful for lookup / quoted spans without inventing synonyms.
- Overlapping single-token stems: if both `version` and `versioning` are present, drop the shorter **unless it is the query**. Phrases with spaces are never pruned this way.

Whole-file `phraseMatch` / `partialPhraseMatch` still apply on top of line scans (see score). Dogfood notes that quote probe queries are demoted via `searchMetaPenalty`, not by omitting the query from the term list.

### 2. Match lines

- Single-token terms: Unicode-ish word boundary (`\bterm\b`), case-insensitive. `version` does not match `versioning`.
- Multi-word terms: case-insensitive substring (so `slash commands` and `grounder migrate` work).
- On a line, the **longest** matching term wins as `matchedTerm` (label only; all matching terms still count toward distinct-term score).
- Frontmatter `topics:` exact-match against terms → `topicsMatch` (ranking boost). Body and frontmatter lines both produce line hits.
- Filename/path segments also count as term matches (`filenameTermCount`).

The scan **always finishes the tree**. Early `--max-hits` stop-scan was removed: it made ranking depend on directory walk order. `--max-hits` now only caps **stored snippets per file** (`min(50, maxHits)`, default 50); ranking still uses full per-file hit counts.

### 2.5. Date filter (`--since` / `--after`)

Optional. Parsed in `commands/search.ts` (`parseSinceDate`): calendar date (`2026-08-01` = local midnight) or relative shorthand (`7d`, `30d`). Before scoring, skip any file whose `mtimeMs` is before the cutoff. Useful for freshness-sensitive queries (recent handoffs, “what did I write about X lately”). `/grounder-search` does not pass this by default.

### 3. Score (higher wins)

Hit density uses **IDF-lite** per term: during the walk, accumulate `termHitCounts` (files containing each term). Each file’s `idfDensity` is the sum of `perTermHits / log(1 + df)` across its matched terms. Common tokens (high document frequency) contribute less; rare identifiers contribute more.

```text
distinctTermCount * 1000
+ min(idfDensity, 100) * 10
+ topicsMatch ? 800 : 0
+ filenameTermCount * 200
+ phraseMatch ? 300 : 0
+ partialPhraseMatch ? 100 : 0
− searchMetaPenalty * 5000
```

**Partial phrase:** for queries with 3+ words, check consecutive word n-grams in file content (bigrams for 3-word queries; **trigrams** for 4+ words). Verbatim `phraseMatch` (+300) almost never fires on natural-language queries; partial match (+100) catches shared phrases like “slash commands” without letting loose bigrams outrank migration-context docs.

Then, as tiebreakers only: **non-archive before archive**, newer `mtime`, folder signal (`notes`/`plans` 2, `logs` 1), then path.

**Distinct terms dominate.** Complementary vault words in the **same** file beat a file that repeats one token. That is why `--terms` must be 3–5 *different* product tokens, not English synonyms of the query.

`searchMetaPenalty` is 1 when the query does **not** contain `search` and the path is `discussions/search/…` or the stem is `search-feature` / `search results`. Weight 5000 is intentional: dogfood notes quote every probe query and otherwise swamp real plans.

### 4. Slice for output

- Default `--limit` in code: **10 files** (`commands/search.ts` / `searchVault`). `--limit` help text matches.
- Default `--context` in `searchVault` if omitted: **1** line. `/grounder-search` passes `--context 2` on the initial search; **`--context 3`** on the optional broaden call.
- Default line hits shown per file: **1** (longest `matchedTerm`). Ranking still uses full hit counts. `--max-hits` caps stored snippets per file during scan (`min(50, maxHits)`; default 50).

### 5. Formats

| Flag | Who | Shape |
| --- | --- | --- |
| (plain) | Humans | Summary line + optional truncation header; numbered stem + absolute path + one-line snippets |
| `--markdown` | Manual/script use | `file://` links (spaces percent-encoded via `pathToFileURL`) + fenced snippets — no skill invokes this for `search` anymore |
| `--json` | Skill (both lookup and hybrid) | See below — **parse privately, never paste** |

`--markdown` and `--json` are mutually exclusive.

**`--json` payload** (top-level):

| Field | Purpose |
| --- | --- |
| `query`, `terms` | Echo normalized inputs |
| `termHitCounts` | `{ "<term>": n }` — keys match `terms` spelling; every term pre-init to `0`; zero-hit terms stay explicit for broaden decisions |
| `summary` | Human-readable count line (same as plain header) |
| `truncated`, `totalMatchCount`, `totalFileCount` | Truncation signal + scan totals |
| `vaultRoot`, `vaultRootUri` | Absolute path / `file://` link for the vault folder actually scanned (same `rootDir` used for `relativePath`) — the skill links this on a zero-hit result so the user can tell which vault was actually searched |
| `hits[]` | Ranked file list |

Each `hits[]` entry:

| Field | Purpose |
| --- | --- |
| `file` | Absolute path — use for Read tool |
| `relativePath` | Vault-relative title (`plans/…`, not `10-Projects/…`) |
| `fileUri` | Pre-encoded `file://` href for markdown links |
| `alsoMatchedHint` | Stem + up to two distinct file terms (`stem — term1, term2`), from all matches not just the shown snippet |
| `mtimeMs`, `topicsMatch` | Metadata |
| `matches[]` | `{ line, term, snippet }` per hit line |

## Skill protocol

Installed from `templates/agents/{cursor,claude}/skills/grounder-search/SKILL.md` via `grounder setup` / `grounder migrate`. `{{GROUNDER_CLI}}` becomes the baked runtime invocation. Cursor requires Shell `required_permissions: ["all"]` (vault is outside the workspace).

After **any** template edit, run `grounder migrate` (hash-safe if the on-disk file is untouched). A new parent chat is not required; `/grounder-search` re-reads the installed file. Un-migrated sessions keep the old spec.

### Modes

- **Hybrid (default, topic/request):** one `search … --json` with `--terms`, full-read CLI hits **1–4** in one parallel batch, synthesize.
- **Lookup:** explicit lookup wording (`exact phrase`, `this line`, `the wording`) **or** leftover is a bare `"quoted span"` → one `search … --json` (no `--terms`, no full reads); format hits directly from JSON (Path links + `matches[]` snippets), CLI order, no synthesis.
- **Zero-hit disclosure (both modes):** if `totalFileCount` is 0 (after broaden, for hybrid), answer `No matches in [<vaultRoot>](<vaultRootUri>) for this topic.` instead of the normal output.

### Query and terms (the ranking contract)

The CLI does not guess intent. The skill **classifies** after stripping retrieval wrappers (`find`, `search for`, `documents discussing`, `notes about`, `look up`), then builds argv.

| Class | Signal | `query` |
| --- | --- | --- |
| **Lookup** | Explicit lookup wording (`exact phrase`, `this line`, `the wording`), **or** leftover is a bare `"quoted span"` | Quoted text (bare `"…"`) or leftover after wrappers, unmodified. `--json`; no `--terms`, no reads; format hits directly or zero-hit disclosure. |
| **Request** | Leftover still has request syntax: `that mention` / `that discuss` / `that talk about`; starts with `plans that` / `notes that` / `docs that` / `documents that`; trailing `both in` / `either in` / `in CLI and` | One primary noun or named command from the topic (tight phrase; do not prefix a product name). Extra nouns go in `--terms`. Never the leftover sentence. |
| **Topic leftover** | Otherwise — leftover is already a topic noun-phrase | Leftover, same words, same order. Do **not** paraphrase. |

Do not recycle the query as a `--terms` item. Template counterexamples use a **different** topic than the eval probes (retry queue / charge+refund).

**Terms** — fill 3–5 slots, then stop (request and topic leftover only; lookup skips `--terms`):

1. Product noun/phrase (`slash commands`) — skip if it would duplicate the query
2. Product verb or CLI name (`grounder migrate` — never lone `migrate`)
3. One on-disk identifier (`hooksEnabled`, `state.json`, `hash drift`, …)
4–5. Another vault/product token

**Never as terms** (unless the user asked about code layout): repo paths, `packages/…`, source module / file stems (`install-command`, `apply-agent-installs`, `hook-runtime`, `vault/search.ts`). Lone high-df words (`plan`, `command`, `cli`) flatten rank. Those match code-ish plan checklists and **reorder the head**.

### Turn budget

Exactly two assistant turns with tools, then the answer:

1. Shell only: `search "<query>" --terms "<csv>" --context 2 --json` (quote `--terms` — unquoted CSV with spaces corrupts argv). Optional second search **in the same round** only when broaden triggers (below).
2. Read only: hits 1–4, parallel, no substitutions.
3. First chat text = the hybrid answer.

No Glob, Grep, extra Shell, `UpdateCurrentStep`, `TodoWrite`. Rounds 1–2 should have **no text part**.

### Broaden (one silent retry max)

Re-run search in round 1 **only if**:

- `totalFileCount` is 0, **or**
- ≤2 hits and every hit is meta (`discussions/search/`, or snippet only quotes the query), **or**
- any term in `termHitCounts` has count **0** (bad term — replace it)

Broaden call uses `--context 3` (weaker matches need richer snippets):

```bash
search "<query>" --terms "<csv-with-replacement>" --context 3 --json
```

**Deterministic strategy:** check `termHitCounts` first — if any term has count 0, replace **that term** with a different product/vault token. If no zero-hit term, drop slot-3 (the on-disk identifier). Keep slots 1–2 (product noun/verb) unchanged. Do not invent new terms or rewrite existing ones.

### Output contract

- One opening sentence of what the vault **says** (not a search recap).
- `## Read these` / `## Also matched` (not bold-only, not `###`).
- Visible title = `hits[].relativePath` from JSON exactly (`plans/…`, never `10-Projects/grounder/plans/…`).
- Href = `hits[].fileUri`; percent-encoding is CLI-owned.
- Number 1…n continuously across sections. Also matched = leftover top-10 **in CLI order**.
- Claims only from files you full-read. Also-matched gloss = path stem or `matches[].term`, one short phrase.

You may list a design/archive authority first **among the four full-reads**. Do not reshuffle Also matched.

## How we got here (do not replay)

### Ranking (CLI)

| Attempt | What happened | Keep / drop |
| --- | --- | --- |
| Recency-first + substring match (`cb6fedb`) | Newest mention of `migrate` beat the schema-versioning plan; `version` hit `versioning` | Dropped |
| Distinct-term score + word boundaries + archive penalty (`b51359b`) | Design docs with several product tokens rise; active files beat archive on ties | **Keep** |
| Scan the full NL query as a term | Dogfood notes that quote the probe query ranked #1 | Dropped briefly (`f25d1d2`: scan only if 1–2 words); **restored** — always include query; multi-word = verbatim substring; dogfood demoted via `searchMetaPenalty` |
| `--max-hits` abort mid-walk | `totalFileCount` / rank depended on `readdir` order | Dropped (always finish the tree). Flag kept as a per-file snippet store cap |
| 3 snippets per file in agent output | Noisy; ranking already has counts | Show 1; store up to 50 for scoring |
| Raw hit-count density | Common tokens (`grounder`) swamped rare identifiers | **Keep** IDF-lite (`idfDensity`) |
| Verbatim-only phrase match | NL queries rarely appear verbatim in vault | **Keep** partial n-gram match (+100; trigrams for 4+ words) |
| Semantic / BM25 / embeddings | Needs an index, deps, and a rebuild story | **Rejected for v1** — vaults are small; scan is sub-second |

### Skill (prompt)

Cross-model runs on the same probe (`find documents discussing handling migrations of slash commands`) taught these leaks. Each “fix” that only added a softer sentence failed on at least one family; **counterexamples** worked better than adjectives.

| Leak | What models did | What actually constrained them |
| --- | --- | --- |
| Priming | Worked example **was** the probe, so every model copied the terms CSV | Terms example is a **different** topic (retry queue / charge+refund). Probe terms CSV must not appear in the template |
| Module names as terms | `install-command`, then `apply-agent-installs` — pulled doctor/checklists to #1 | Name **both** stems in the never-list; “source modules” alone was too abstract |
| Query rewrite | Composer shortened to `slash command migrations` | Explicit wrong query next to the leftover-topic rule; canonical probe is **topic leftover**, not a request |
| Request leftover as query | `find plans that mention…` kept as `query` (request English never appears in the vault) | Classify **request**; primary noun as `query`; explicit wrong leftover-as-query |
| Parent-vault titles | Gemini used `10-Projects/grounder/plans/…` | Wrong-title example with that prefix |
| `%20` in link text | Sonnet encoded the visible title | Correct vs wrong markdown pair |
| Extra tools | Glob, `UpdateCurrentStep`, duplicate Shell, third turn | Allowlist: Shell then Read only |
| JSON / snippets in chat | Relayed stdout | “Parse `--json` internally only” |
| Also-matched order | Reshuffle / restart at 1 | “CLI leftover order” + continued numbering |
| Silence | “I’ll search…”, “**Analyzing…**” in the same message as tools | Still leaky on Gemini/Grok/Composer. Do not spend another round of adjectives here without a mechanical check (see Open) |

**Forbidden terms are a stability rule, not a “worse hits” rule.** `install-command` once surfaced a living doctor/migrate plan that the clean term set missed. We still ban it: otherwise every model searches the *codebase vocabulary* and ranking diverges.

## Canonical probe (for the next change)

Use this utterance, **without** putting its terms CSV back as the worked example. It is **topic leftover** (`documents discussing` is a wrapper), not a request — do not shorten it to keywords.

```text
find documents discussing handling migrations of slash commands
```

Healthy `query` / `--terms`:

```text
class: topic leftover
query: handling migrations of slash commands
terms: slash commands,grounder migrate,hash drift,hooksEnabled,state.json
```

Second probe (request-shaped; **do not** put this utterance or its terms CSV in the template):

```text
find plans that mention altering doctor or status command, both in CLI and slash command
```

```text
class: request
query: doctor
terms: grounder status,slash command,grounder doctor,status.ts
wrong query: plans that mention altering doctor or status command, both in CLI and slash command
```

Healthy CLI head (this vault, 2026-08-20):

1. `plans/archive/0.3.0/schema_versioning_for_grounder_ac9204ad.plan.md`
2. `plans/archive/0.3.0/0-3-0-release-review.md`
3. `plans/archive/0.4.0/doctor-hash-drift-check-output-unification.md`
4. `plans/archive/0.3.0/rutime-improvements.md`

Replay each model’s **exact argv** against `grounder search … --json` before blaming synthesis. Protocol (silence, tool names, heading shape) lives in subagent transcripts, not in the parent’s summary.

Evaluate **one change at a time** (CLI xor template). Migrating templates mid-experiment without recording the installed file hash makes before/after incomparable.

## Open (known, not “just prompt harder”)

- **Silence** is still violated by chatty models; Composer may put the real answer on `UpdateCurrentStep` and stub the user-visible message. Prompt text has diminishing returns.
- **`--terms` quality** remains the ranking incompatibility. The recipe + never-list + `termHitCounts` zero-hit broaden is the v1 mitigation. Request vs leftover classification is the v1 mitigation for request-shaped utterances.
- **Read order in synthesis** — some models substitute hits 1–4 despite template rules; template tests cannot catch live agent behavior.
- Template tests are string-contains on the markdown, not live agents. They catch priming regressions and broaden protocol text; they cannot catch Gemini narration or Composer read-order swaps.

## Key code map

| Concern | Location |
| --- | --- |
| Scan + rank | `packages/grounder/src/vault/search.ts` |
| CLI parse / formats | `packages/grounder/src/commands/search.ts` |
| Help text | `packages/grounder/src/help.ts` (`id: "search"`) |
| Project vault root | `connector/vault.ts` `resolveProjectVaultRoot` → `vault/layout.ts` `projectDir` |
| Cursor / Claude templates | `templates/agents/{cursor,claude}/skills/grounder-search/SKILL.md` |
| `{{GROUNDER_CLI}}` bake | `desiredArtifacts()` in `agents/cursor.ts` / `agents/claude.ts` |
| Command file list | `agents/cursor.ts`, `agents/claude.ts` (`grounder-search/SKILL.md`) |
| Template contract tests | `test/templates/grounder-search.test.ts` |
| Rank unit tests | `test/vault/search.test.ts` |
| CLI output / scope / errors | `test/commands/search/*.test.ts` |
| `file://` encoding | `test/commands/search/markdown-output.test.ts` |
| Contributor overview | `docs/architecture/vault-search.md` (this file) |

## Rejected alternatives

- **Agent greps the vault** — duplicates the ranker, blows the turn budget, ignores `topics:` / distinct-term scoring.
- **Search the git repo from `/grounder-search`** — wrong tree; that is a code question, not vault memory.
- **Embeddings / sqlite FTS for v1** — vaults are small; an index is another stale artifact. Revisit if scan latency or corpus size actually hurts.
- **Recency as the primary key** — newest handoff mentioning a word beats the design doc every time.
- **Let the model pick which of the top 10 to read** — they skip the authority doc. Always read 1–4 in CLI order; judge relevance only while writing.
- **Relay `--json` to the user** — the hybrid contract is the product; JSON is an internal wire format.
- **One mega example that is also the eval probe** — models copy it and you cannot tell whether the recipe works.
