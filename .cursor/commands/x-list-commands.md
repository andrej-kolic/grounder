Compare how different models relay Grounder `list` CLI markdown.

## Goal

For each model below, spawn **one** Task subagent (`subagent_type: "shell"` or `"generalPurpose"`) that runs the three Grounder list subcommands and returns their **exact stdout** (no paraphrase, no wrapping commentary, no reformatting).

Then combine every agent’s unmodified outputs into a single markdown file and save it.

## Models (one subagent each)

Launch all five in **parallel** in a single message. Pass `model` exactly as listed:

| H1 title in output | Task `model` slug |
|---|---|
| grok | `cursor-grok-4.6-high-fast` |
| sonnet 4.5 | `claude-4.5-sonnet-thinking` |
| gemini 3.5 flash | `gemini-3.5-flash` |
| composer 2.5 | `composer-2.5-fast` |
| gpt 5 mini | `gpt-5-mini` |

Do not substitute other models. If a slug is unavailable, record that agent’s sections as the literal error text from the Task tool and continue with the rest.

## What each subagent must do

Working directory: the Grounder repo root (`packages/grounder`’s parent).

Run these three commands **in order**, each with Shell `required_permissions: ["all"]` (vault lives outside the workspace):

```bash
pnpm grounder plan list --markdown
pnpm grounder note list --markdown
pnpm grounder handoff list --markdown
```

Return a structured reply the parent can copy verbatim:

1. A line `### plan list` then a fenced block containing **only** that command’s stdout (or stderr+exit code if it failed).
2. A line `### note list` then the same for note list.
3. A line `### handoff list` then the same for handoff list.

The subagent must not summarize, rewrite links, strip trailing spaces, or add extra headings beyond those three `###` lines.

## Parent: assemble the document

1. Ensure the repo-local `.tmp/` directory exists (`mkdir -p .tmp` at the Grounder repo root).
2. Pick `<n>` as the **lowest positive integer** whose path `.tmp/list-commands-<n>.md` does not already exist (start at `1`, then `2`, …). Do not reuse or overwrite an existing file.
3. Write one document with this exact shape (blank line between sections):

```markdown
# <H1 title from table>

### plan list

<unmodified plan list stdout>

### note list

<unmodified note list stdout>

### handoff list

<unmodified handoff list stdout>

# <next agent>
…
```

4. Agent order must match the table (top to bottom). Keep each CLI stdout byte-for-byte as returned — do not normalize whitespace or “fix” markdown.
5. Write the file to `.tmp/list-commands-<n>.md` under the repo root.
6. Reply to the user with only the absolute path written and a one-line note if any agent failed.
