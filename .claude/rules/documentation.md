---
paths:
  - README.md
  - docs/**
---
<!-- playbook:documentation v1 (2026-09-08) -->

# Documentation Conventions

Governs README and `docs/` prose — not JSDoc/API comments (see the separate `jsdoc` rule) and not conversational responses (see `conversation-style`).

Defer to this project's own written documentation conventions where they exist — a style guide, a `CONTRIBUTING.md` section, or explicit conventions stated in the repo. The mere presence of a `docs/` folder isn't itself a convention — use the rules below unless there's an actual written standard to follow.

1. **Know the mode before you write** — Per the [Diátaxis](https://diataxis.fr/) framework, a doc is one of four things: a tutorial (learning by doing), a how-to guide (steps for a specific task), a reference (facts to look up), or an explanation (background and why). Don't mix modes within one document. The README is the exception: Diátaxis treats an index/landing page as a hub, not a fifth mode — it's allowed to combine a short overview, a quick-start, and links out, because its job is to route the reader to the right single-mode doc, not to be one itself.
2. **Keep the README short** — Overview, quick start, links out for depth. Push reference detail and background explanation into `docs/`, not the README itself.
3. **Scale doc count to the project, not the README's job** — A small project might need only one or two files under `docs/` beyond the README. A larger one grows into the full Diátaxis structure — separate tutorial, how-to, reference, and explanation docs (or a dedicated docs site). Either way the README stays a short hub per rule 2 — this rule is about how many other documents exist, not about loosening rule 2.
4. **Docs-as-code** — Update documentation in the same change that changes the behavior it describes, not as a follow-up. A doc describing old behavior is actively worse than no doc.
5. **Plain language** — Cut fancy words, filler, and unexplained jargon. A reader looking something up wants the fact, not the buildup.
