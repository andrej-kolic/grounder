Hydrate this session from the latest vault handoff and repo truth.

Read-only — do not write to the vault. Do not invent vault paths.

From the linked project folder or any subdirectory beneath it:

1. Get the current handoff (skips empty/unreadable files, same pick as the session-start teaser):

   npx grounder handoff list --head

2. If empty: tell the user there are no handoffs yet, then read repo `AGENTS.md` only and proceed.

3. Otherwise, read that file. If the user names a specific session instead, run `npx grounder handoff list --limit 5` and read the path they mean.

4. Read repo `AGENTS.md` (project conventions and constraints).

5. Summarize briefly what is next (from the handoff `## Next` section when present), then start work.

The vault is outside the workspace — approve shell permissions if Cursor prompts you.
Use free-text after `/grounder-task` as optional focus (session name, index, or task hint).
