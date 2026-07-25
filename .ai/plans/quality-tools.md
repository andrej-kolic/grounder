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
   Automate what is today `pnpm --filter grounder publish` (manual, local, token-in-shell). Goal: push a version tag → CI publishes to npm + opens a GitHub Release. Do this when you are ready to ship beyond `0.0.1`, not before CI/`pnpm check` are green.

   **Recommendation for this repo: tag-driven, not Changesets.**  
   One publishable package (`packages/grounder`), rare releases, no multi-package version graph. Changesets adds changelog PRs, bots, and config for little gain until that changes. Revisit Changesets only if you split packages or want PR-linked release notes.

   #### Release model

   | Step | Who | What |
   | --- | --- | --- |
   | Bump | Human (local) | Edit `packages/grounder/package.json` `version` to match the tag (semver) |
   | Tag | Human | `git tag vX.Y.Z && git push origin vX.Y.Z` (annotated preferred) |
   | Gate | CI | Re-run `pnpm check` on the tag (do not trust “main was green yesterday”) |
   | Publish | CI | `pnpm --filter grounder publish --no-git-checks` (or `npm publish` from package dir after build) |
   | Announce | CI | `gh release create` from the same tag (notes = commit range or `--generate-notes`) |

   Version source of truth: **`package.json` version must equal the tag** (`v0.1.0` ↔ `"0.1.0"`). Fail the job early if they diverge — avoids publishing the wrong number.

   #### Auth: prefer OIDC (trusted publishing), keep `NPM_TOKEN` as fallback

   - **OIDC (preferred):** On npmjs.com → package Settings → Trusted Publisher → GitHub Actions. Bind org/user, repo, and **exact** workflow filename (e.g. `release.yml`). Workflow needs `permissions: id-token: write` (+ `contents: write` if creating a GitHub Release). Use npm CLI ≥ 11.5.1 in the job (`npm i -g npm@latest` after setup-node). Provenance is emitted automatically with trusted publishing; optional: `"publishConfig": { "access": "public", "provenance": true }`.
   - **First publish:** Done — `grounder@0.0.1` already on npm ([npmjs.com/package/grounder](https://www.npmjs.com/package/grounder)), maintainer `andrejkolic`. OIDC can be used for the next version bump; no one-shot local create needed.
   - **Publishability check (2026-07-25):** Name owned; `publishConfig.access: public` + `prepublishOnly` present; `bin` has shebang; `pnpm pack` includes `dist/`, `templates/`, README, LICENSE. Local meta drift vs npm (description + `license: MIT` vs published `ISC`) will sync on next publish.
   - **Trusted Publisher (#3) — repo-side done; npm UI needs you:**
     - `packages/grounder/package.json` now has `repository.url` = `git+https://github.com/andrej-kolic/grounder.git` (required for GitHub OIDC/provenance; must match exactly).
     - No npm CLI for this — configure at [npmjs.com/package/grounder/access](https://www.npmjs.com/package/grounder/access) → Trusted Publisher → GitHub Actions:
       | Field | Value |
       | --- | --- |
       | Organization or user | `andrej-kolic` |
       | Repository | `grounder` |
       | Workflow filename | `release.yml` |
       | Environment name | *(leave blank)* |
       | Allowed actions | `npm publish` |
     - npm may 404 on save if `release.yml` is missing from the default branch (observed 2026-07-25). Push `.github/workflows/release.yml` first, then configure Trusted Publisher.
     - After a successful OIDC publish: optionally Settings → Publishing access → “Require 2FA and disallow tokens”.
   - **`NPM_TOKEN` fallback:** Granular automation token in repo secrets, `NODE_AUTH_TOKEN` via `actions/setup-node` `registry-url: https://registry.npmjs.org`. Rotate every ≤90 days if classic tokens stay deprecated. Prefer OIDC so you are not babysitting secrets.

   #### Workflow shape (`.github/workflows/release.yml`)

   ```text
   on:
     push:
       tags: ['v*']

   jobs:
     release:
       runs-on: ubuntu-latest
       permissions:
         contents: write    # GitHub Release
         id-token: write    # npm OIDC
       steps:
         checkout (fetch-depth 0 if generating notes)
         pnpm + Node (one version, e.g. 22 — not a matrix)
         pnpm install --frozen-lockfile
         assert tag vX.Y.Z == packages/grounder version X.Y.Z
         pnpm check
         pnpm --filter grounder publish --access public --no-git-checks
         softprops/action-gh-release (or gh release create) with generate_release_notes
   ```

   Keep **CI** (`ci.yml`) on PR/main; keep **release** separate so publish never runs on every push. Do not matrix Node on release — one known-good runtime is enough.

   #### Local checklist before tagging

   1. `main` green; changelog / release notes drafted if you care (optional until Changesets).
   2. Bump `packages/grounder/package.json` version; commit on `main`.
   3. `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main --follow-tags` (or push tag after merge).
   4. Watch `release.yml`; confirm npm page + GitHub Releases.

   Optional later: `pnpm version` / a tiny `scripts/release.mjs` that bumps, commits, and tags in one shot — still human-triggered, never auto-bump from CI.

   #### Out of scope for v1 of this workflow

   - Prerelease channels (`--tag next`) unless you need them
   - Changesets / Release Please bots
   - Publishing from forks or `workflow_dispatch` without a tag (easy to mis-fire)
   - Dual-publishing to GitHub Packages

   #### Done when

   - Tagging `v*` on the default branch tip publishes `grounder@X.Y.Z` and creates a matching GitHub Release
   - No long-lived npm token required for steady-state publishes (OIDC)
   - README “publish” section points at the tag flow instead of raw `pnpm --filter grounder publish`

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
.github/workflows/release.yml     # npm publish + GitHub Release on v* tag
pnpm check                        # local/CI one-shot
biome                             # format + basic lint
```

Happy to turn any slice into a concrete plan next (CI-only first is usually the right cut).

