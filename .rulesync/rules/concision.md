---
root: false
targets: ["claudecode", "cursor"]
description: "Concision: what to cut from any written output, chat or file."
globs: []
cursor:
  alwaysApply: true
---

<!-- playbook:concision v1 (2026-09-21) -->

# Concision

Governs what to cut from anything written — chat replies, rules, READMEs, commit bodies, code comments. The sibling rules govern each artifact's structure (`conversation-style`, `documentation`, `jsdoc`, `git`); this one governs its length.

1. **Lead with the result and the action.** First sentence answers the question or states what happened and what you would do. Details after. Never restate the question before answering it.
2. **State the instruction, not the argument for it.** Rationale earns its place only where the reader has to make a decision, or where the obvious alternative is wrong for a non-obvious reason.
3. **One copy of a fact**, in the place its reader needs it. The same point in two documents drifts; the second copy is deleted, not paraphrased.
4. **Cut any sentence whose only job is defending the previous one.**
5. **A list when items get referenced or compared**, prose otherwise. Three short items that fit on one line are one sentence. When a list is right, number it so items can be cited.
6. **Name the thing.** No intensifiers, no hedges, no "it's worth noting", no restating what you just did before doing the next part.
7. **Report outcomes, not process.** What changed, what it cost, what is still wrong. A correction is a clause, not a paragraph — make it and move on.
8. **Gloss an unfamiliar term on first use** — a few words inline, never a bare term the reader has to look up. A gloss is not padding; it is what lets the rest be short.

Concision is not omission: a constraint, a failed check, or a caveat the reader would act on stays in, stated plainly.
