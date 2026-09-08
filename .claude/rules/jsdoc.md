---
paths:
  - '**/*.{js,jsx,ts,tsx,mjs,cjs}'
---
<!-- playbook:jsdoc v1 (2026-09-08) -->

# JSDoc Conventions

Governs `/** */` API documentation comments only — not inline code comments (those follow the project's own house style) and not README/docs prose (see the separate `documentation` rule).

Defer to this project's own established JSDoc/TSDoc conventions where they exist — a style guide, `CONTRIBUTING.md`, an `eslint-plugin-jsdoc` config, or a consistent existing pattern in the codebase. Use the rules below only where no such convention exists.

1. **Public API only** — Document exported functions, classes, and types that other modules or consumers will call without reading the implementation. Don't add JSDoc to private/internal helpers just for coverage's sake.
2. **Contract, not narration** — The first line states what it does, in terms a caller can act on without reading the body. Don't restate the code (`@param {string} name - the name` is filler).
3. **Only the non-obvious tags** — Skip `@param`/`@returns` whose type and name already say everything. In `.ts`/`.tsx`, the type annotation already says the type — don't add `@param {Type}` to restate it; use `@param` only when the name needs a description the type can't carry. Use `@throws` and side-effect notes for what the signature can't express.
4. **Stale is worse than absent** — A comment describing behavior the code no longer has actively misleads. Update or delete it in the same change that changes the behavior.
