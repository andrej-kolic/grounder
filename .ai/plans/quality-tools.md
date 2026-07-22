**Verdict:** For a ~1.5k LOC single-package CLI with Vitest already in place, aim for a thin quality gate — not a full platform stack. Current gap: local `build`/`test` only; no CI, lint/format, typecheck script, or release automation.

### Do soon (high leverage)

1. **GitHub Actions CI**  
   On PR + main: install with frozen lockfile → `pnpm build` → `pnpm test`. Matrix Node 18 + current LTS. That’s the single biggest quality win.

2. **Explicit typecheck**  
   You already have a no-emit `tsconfig`; expose `pnpm typecheck` and run it in CI. Catches what build alone can miss once emit settings diverge.

3. **One formatter + light linter**  
   Prefer **Biome** (or Prettier + ESLint flat) — one tool, minimal config. Format on save + CI check. Skip heavy plugin ecosystems.

4. **Root scripts as the contract**  
   `typecheck`, `lint`, `format`, `check` (all of the above). CI and agents should call the same entrypoints.

### Nice next (when publishing matters)

5. **Release workflow**  
   Tag-driven or Changesets → GitHub Release + `npm publish` with OIDC/`NPM_TOKEN`. Replaces manual `pnpm --filter grounder publish`.

6. **`engines` + packageManager**  
   Pin `packageManager: "pnpm@…"` (Corepack) so CI and contributors match. Optionally fail CI on unsupported Node.

7. **Dependabot / Renovate**  
   Weekly PRs for deps only — keep the surface small.

### Skip / defer for this size

- Turbo/Nx, monorepo orchestration  
- Husky/lefthook (CI is enough until contributors multiply)  
- Coverage gates, mutation testing, Sonar  
- Bundle/size budgets (CLI, not a browser lib)  
- Multi-OS matrix beyond maybe one Linux job (add macOS later if path/symlink bugs show up)

### Suggested shape

```text
.github/workflows/ci.yml          # build + typecheck + lint + test
pnpm check                        # local/CI one-shot
biome (or prettier+eslint)        # format + basic lint
(optional later) release.yml      # npm publish on tag
```

Happy to turn any slice into a concrete plan next (CI-only first is usually the right cut).

