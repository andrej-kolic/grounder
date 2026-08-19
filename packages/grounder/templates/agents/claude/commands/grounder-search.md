Search this project's vault content for relevant context.

Use this when the user asks to find prior project-vault context by topic, keyword, concept, or phrase.

Scope is this linked project only — the CLI resolves and searches under the linked project vault root. Do not search outside it.

## Output contract (default — hybrid)

**Silent preflight — mandatory:**
- Do not narrate steps ("searching…", "narrowing…", "reading files…").
- Do not echo commands or shell output.
- **Never show CLI JSON, snippets, or raw stdout** — parse `--json` internally only.
- Send **one** final synthesized response to the user.

Structure like a **curated reading list**, not homework. Keep summaries tight — one bold label line per file, then a handful of short bullets (not paragraphs).

1. **Opening** — one sentence: what vault notes discuss [topic], ordered by relevance.
2. **Primary design docs** — top 1–3 files. For each:
   - `### N. \`plans/…\`` (numbered, vault-relative path)
   - **Bold one-line role** (e.g. "**The main design document.**")
   - 3–6 short bullets max; optional one-line status if relevant
3. **Operational / follow-up plans** — same shape, numbered from 4+
4. **Lighter mentions** — table: `| Document | What it says |` — one short phrase per row
5. **Not really about [topic]** — brief list of keyword hits that aren't on-topic
6. **Start here** — 1–3 paths, one line

**Lookup mode** (skip synthesis): exact mention / line reference only → relay CLI `--markdown` stdout as-is after one search pass.

## Steps

1. Reformulate the user's query into 3–5 practical keyword variants:
   - Keep the original phrase as the primary `query`.
   - Add likely synonyms, abbreviations, and alternate phrasing.
   - Do **not** add shorter stems when a longer form is already present (e.g. skip `version` when the query is `versioning`).
   - Prefer concrete terms over broad words; avoid generic tokens that appear in unrelated contexts unless the user asked for them.

2. **One CLI call** (do **not** pass `--limit` unless the user asks for more):

```bash
{{GROUNDER_CLI}} search "<query>" --terms <csv> --context 2 --json
```

`--context 2` gives enough snippet context for triage; CLI returns **1 match per file** by default.

Parse the JSON privately. Extract ranked paths from `hits[].file`.

**No retry for noisy or truncated results** — synthesis filters noise; truncation only affects the candidate tail you didn't read anyway.

**Optional second call (0 files only):** if `totalFileCount` is 0, broaden `--terms` once and re-run silently. Never retry because results feel noisy.

3. **Read top candidates** (required unless lookup mode):
   - Read the **full file** for CLI-ranked hits **1–5** (fewer if filenames/snippets already show a hit is tangential).
   - Grant read permissions for vault paths outside the workspace when needed.

4. **Synthesize** from full reads plus CLI metadata for lower-ranked hits:
   - Ground every claim in file content — do not invent.
   - Rank and tier using substance from full reads, not keyword density alone.
   - Prefer archive/design docs when they are the authoritative source.

Run from the linked project folder or any subdirectory beneath it.
The vault is outside the workspace — grant shell permissions if Claude Code prompts you.
Do not write to vault files during search.
Do not grep the vault yourself — the CLI ranks candidates; you read, judge, and synthesize.
