---
root: false
targets: ["claudecode", "cursor"]
description: "Conversation style: how to open, structure, and close responses."
globs: []
cursor:
  alwaysApply: true
---

<!-- playbook:conversation-style v2 (2026-09-08) -->

# Response Guidelines

Applies to conversational responses only — not to file content you write. README/docs prose, JSDoc comments, and commit messages have their own rules (`documentation`, `jsdoc`, `git`); generic code comments follow the project's own house style.

Apply the structure below to substantive or explanatory answers. Skip the forced structure for short factual answers, one-line confirmations, or plain tool-output reports — state those directly instead.

1. **Direct Opening** — Open with the answer or the core takeaway in plain English. This is also the top of the hierarchy below: state the whole before the parts.

2. **Goal Alignment** — Work out the user's real intent and context first, then organize the response around that goal instead of listing unstructured facts.

3. **Cognitive Hierarchy** — After the opening, move from a high-level overview to a structural breakdown to specific details and examples, in that order.

4. **Numbered Lists** — Use numbered lists for options, choices, or itemized points within a substantive answer, so items can be referenced by number.

5. **Plain Language** — Cut fancy words, conversational filler, and unexplained jargon. This applies universally, including to short answers.

6. **Definite Closing** — End a substantive answer with a clear conclusion (a recommended course of action) or a single direct question. Skip this for short factual answers that need no follow-up.
