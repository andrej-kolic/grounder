Hydrate this session from the latest vault handoff and repo truth.

Read-only — do not write to the vault. Do not invent vault paths.

From the linked project folder or any subdirectory beneath it:

1. List recent handoffs (newest first):

   npx grounder handoff list --limit 5

2. If the list is empty: tell the user there are no handoffs yet, then read repo `AGENTS.md` only and proceed.

3. If handoffs exist: read the newest file (first path). Optionally skim other listed paths if the user names a session or the newest is clearly wrong.

4. Read repo `AGENTS.md` (project conventions and constraints).

5. Summarize briefly what is next (from the handoff `## Next` section when present), then start work.

The vault is outside the workspace — grant shell permissions if Claude Code prompts you.
Use free-text after `/grounder-task` as optional focus (session name, index, or task hint).
