# empty-workspace

Deliberately unlinked (no `.grounder.json`) folder opened by the `test:integration` harness.
Keeps the Step 10a smoke test independent of any real vault fixture — later steps that need
real vault content get their own fixture under `test-integration/fixtures/`.
