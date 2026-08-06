## Summary of the actual fix

**Root cause:** slash-command templates said `npx grounder …`, which resolves against the registry whenever the linked project doesn't declare `grounder` as its own dependency (true for virtually every real linked project) — identical to the bug already fixed for session hooks, just never extended to commands.

**Fix — extended the existing `hook-runtime.ts` shim mechanism to slash commands:**
1. Added `runtimeInvocation(homeDir)` to `hook-runtime.ts` — the shared `'<node>' '<runtime cli.js>'` prefix, refactored `peekHookCommand` to reuse it.
2. Templates (`templates/agents/{cursor,claude}/commands/*.md`) now reference a `{{GROUNDER_CLI}}` placeholder instead of literal `npx grounder`.
3. `cursor.ts`/`claude.ts`'s `installCommand` now reads the template, substitutes the placeholder with the real runtime invocation, and writes it out (was a plain `copyFile`).
4. `commands/vault/init.ts` now materializes `~/.grounder/runtime` unconditionally whenever any agent is being installed — not just when `--hooks` is passed — since slash commands depend on it too now.
5. `doctor.ts`'s runtime-staleness check now fires when either commands *or* hooks are installed, not hooks-only.
6. Updated `hook-runtime.ts`'s doc comment, the error message, and all affected tests (`cursor.test.ts`, `claude.test.ts`, `init.test.ts`, `doctor.test.ts`).
7. Updated `packages/grounder/README.md` and `fixtures/dev/README.md` to describe the new mechanism (dropped now-inapplicable `npx`/dependency-resolution caveats — including the one I wrote incorrectly two turns ago, which is now moot since there's no `npx` involved at all).

**Net effect:** slash commands and session hooks now both point at the same durably-materialized, version-consistent runtime — no more silent registry drift, and (as a side effect) `fixtures/dev` dogfooding now genuinely exercises local changes without any dependency-declaration trick.

One naming note I left as-is deliberately: `installHookRuntime`/`isHookRuntimeStale`/`hook-runtime.ts` still say "hook" even though they're now shared infra. Renaming those is purely cosmetic and would touch several more files — happy to do it in a follow-up if you want the naming cleaned up too.


## Versioning system?

Yes for a **schema version**, no for tying reinstall to **package version** — and I’d still keep `--force` / no silent clobber for command markdown.

### Why the `npx` check is weak long-term
It’s a one-shot content sniff for *this* migration. The next template change (new slash command, different CLI shape, frontmatter, etc.) needs another ad-hoc detector. Doctor/runtime already have a cleaner pattern: an explicit manifest.

### What I’d version
Track an integer **commands artifact schema** (or `commandsSchema`) under `~/.grounder/`, not `package.json` version.

| Bump when | Don’t bump when |
| --- | --- |
| Install contract of command files changes (placeholders, required args, new/removed command) | Every npm release / runtime-only bugfix |
| Baked invocation shape changes (e.g. this `npx` → runtime move) | Unrelated CLI features |

Runtime already has `manifest.json` + version for the **copy/symlink** case. Commands need a sibling concept because they are separate durable files with different force semantics.

### Force semantics (the real design choice)
Hooks can self-heal without `--force` because Grounder owns one JSON entry and can rewrite it safely.

Slash commands are **user-editable markdown**. Auto-rewriting them on every schema bump will surprise people who customized `/grounder-task` etc. So:

1. **Doctor** warns on schema mismatch → `vault init --force` (or a dedicated migrate path).
2. **`vault init` without `--force`** still skips existing command files *unless* you add an explicit “safe migrate” rule (e.g. only rewrite if file hash matches last known shipped template — husky-style; more work).
3. Don’t make “grounder upgraded → rewrite all commands” the default.

### Concrete shape (minimal)
Something like `~/.grounder/artifacts.json`:

```json
{
  "commandsSchema": 2,
  "agents": {
    "cursor": { "schema": 1, "nodePath": "/…/node" },
    "claude": { "schema": 2, "nodePath": "/…/node" }
  }
}
```

- `vault init` writes current schema after install.
- Missing file / `schema < CURRENT` → doctor warn (and optionally vault-init migrates with `--force`, or without `--force` only when hashes match).
- Bonus: stored `nodePath` covers the nvm nit without sniffing command bodies.

Embedding `<!-- grounder-schema: 2 -->` in the markdown is possible but worse (visible, easy for users to strip, couples versioning to file format).

### Recommendation
Keep the `npx` heuristic **only as the bootstrap** for “pre-schema installs” (treat missing artifacts manifest as schema 0 / legacy). Then introduce `commandsSchema` so the next migration doesn’t invent another content regex.

I would **not** auto-reinstall on every grounder version bump — that fights the idempotent “don’t clobber user-edited vault/agent content” rule in `AGENTS.md`.

If you want to go ahead, the smallest useful slice is: artifacts manifest + doctor warn on mismatch + keep `--force` for the rewrite. Hash-based auto-migrate of unmodified files can be a follow-up.

