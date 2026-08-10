Save a note to the Obsidian vault for this project.

Run from the linked project folder or any subdirectory beneath it:

  {{GROUNDER_CLI}} note "<user text>"

Run {{GROUNDER_CLI}} with `required_permissions: ["all"]` (vault is outside the workspace).

Use the text after `/grounder-note` as the note body.
Do not compute vault paths or write files yourself — the CLI handles it.
Report the CLI output path from stdout to the user.
