<!-- playbook:testing v1 (2026-09-08) -->

# Testing Conventions

Governs what to test and how to write the test itself — not which framework/runner to use or CI configuration; use whatever this project already has.

Defer to this project's own established testing conventions where they exist — an existing test suite's patterns, a `CONTRIBUTING.md` section, a lint rule for test files. Use the rules below only where no such convention exists.

1. **Behavior, not implementation** — Test what the code does (given these inputs, this output or side effect), not how it does it (which private method it called, what data structure it used internally). If a refactor that doesn't change behavior breaks the test, the test was coupled to implementation.
2. **Name the scenario and the expected outcome** — `returnsEmptyList_whenInputIsNull`, not `test1` or `testFoo`. A failing test's name should say what broke without opening the file.
3. **Mock only external boundaries** — network, filesystem, clock, database. Don't mock code this project owns just to isolate a unit; that's what makes tests break on harmless refactors.
4. **Deterministic and independent** — no hard-coded sleeps, no shared mutable state between tests, no dependency on run order. A test that's sometimes red for no code reason gets fixed or deleted, not retried into green.
5. **Test the change, in the change** — new or changed behavior gets a test in the same commit, not a follow-up. A test describing behavior the code no longer has is actively misleading, same as stale documentation.
6. **Coverage is a signal, not the goal** — a test that exercises a line without asserting real behavior is worse than no test: it looks like safety and provides none.
