## What this changes and why

## Testing

- [ ] `pnpm check` passes (build + typecheck + lint + test)
- [ ] Tests added or updated, if this changes behavior (mirroring `src/` layout in
      `test/` for `packages/grounder`; leave unchecked for docs-only or config-only changes)
- [ ] If `packages/vscode-extension/` changed: `pnpm --filter grounder-vscode test:unit`
      passes (root `pnpm check` doesn't run the extension's own tests)

## Related

<!-- Closes #123, if this closes an issue -->
