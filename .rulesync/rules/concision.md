---
root: false
targets: ["claudecode", "cursor"]
description: "Concision: what to cut from any written output, chat or file."
globs: []
cursor:
  alwaysApply: true
---

<!-- playbook:concision v4 (2026-09-23) -->
<!-- source: andrej-kolic/playbook .rulesync/rules/concision.md; edits elsewhere are overwritten -->

# Concision

Governs the length of anything written — chat replies, PR and issue bodies, review comments, status reports, rules, READMEs, commit bodies, code comments. The sibling rules govern each artifact's structure (`conversation-style`, `documentation`, `jsdoc`, `git`); this one governs how long it is allowed to be.

## Budgets

A budget is a hard line count, not a target to aim near. "Concise" is an adjective and can always be argued; a number cannot.

| Artifact | Budget |
|---|---|
| Chat reply | 10 lines, until the reader asks for more |
| PR or issue body | 6 lines |
| Review comment | 3 lines |
| Commit body | 3 lines, or none |

Over budget means cut, not shrink the font: drop a whole point, don't compress every sentence into jargon.

**The first line is contractual.** Test it by deleting everything else — the reader must still know the problem, the action, and the result. If they don't, the first line is wrong, and no amount of text below fixes it.

## Failsafes

Never "exceed the budget when it matters" — that is the adjective problem again. Detail that doesn't fit is relocated, not deleted.

1. **Carve-outs, a closed list.** These never count against a budget: a blocker, a failed check, a destructive or irreversible action, an assumption being made, a direct question to the reader. Anything not on this list is subject to the number.
2. **Budget counts explanation, not payload.** Asked for twelve items, the answer is twelve items. The number constrains the prose around a deliverable, never the deliverable.
3. **Overflow gets a home and a pointer.** Move the detail to the plan file, the commit body, or a scratch file, and spend one line saying what was left out and where it went — "wrap risk unchecked, noted in the plan". Only when something was actually left out; a pointer on every reply is boilerplate, and boilerplate is read as nothing.

## Cuts

1. **Lead with the result and the action.** First sentence answers the question or states what happened and what you would do. Details after. Never restate the question before answering it.
2. **State the instruction, not the argument for it.** Rationale earns its place only where the reader has to make a decision, or where the obvious alternative is wrong for a non-obvious reason.
3. **One copy of a fact**, in the place its reader needs it. The same point in two documents drifts; the second copy is deleted, not paraphrased.
4. **Cut any sentence whose only job is defending the previous one.**
5. **A list when items get referenced or compared**, prose otherwise. Three short items that fit on one line are one sentence. When a list is right, number it so items can be cited.
6. **Name the thing.** So the reader knows it at a glance: a page by its address or visible title, a UI element by its look and position, a file by its path — never by a term from a source the reader hasn't read (the code, a design doc) or a label you coined. No intensifiers, no hedges, no "it's worth noting", no restating what you just did before doing the next part.
7. **Report outcomes, not process.** What changed, what it cost, what is still wrong — name the file, the value, the decision, not the tool or method that produced it. A correction is a clause, not a paragraph — make it and move on.
8. **Replace a term the reader doesn't need; gloss one they do** — swap a term from a source the reader hasn't read (the code, a design doc, your own shorthand) for its plain description. Gloss a term the reader will meet again in a few words inline on first use. A gloss is not padding.

Concision is not omission. A constraint, a failed check, or a caveat the reader would act on stays in — see the carve-outs. Cutting one of those to make a number is a worse failure than going long.
