# Runtime invocation (baked Node + home runtime)

How Grounder invokes itself from session hooks and skills — and why the absolute Node path is intentional.

User-facing steps (`grounder migrate`, doctor hints) live in [packages/grounder/README.md](../../packages/grounder/README.md). Ledger / reconciliation details are covered in [state-reconciliation.md](./state-reconciliation.md). This doc is for contributors.

## Problem

Hooks and skills used to shell out via `npx grounder …`. That resolves against the *current project's* dependencies (or fetches `grounder@latest`), so linked repos that do not declare Grounder get the wrong binary. Global install / `pnpm link` does not fix that fallback.

A second constraint: editor-spawned subprocesses (Cursor hooks, Claude Code `sh -c`) do not reliably get a login-shell `PATH`. Bare `node` or `#!/usr/bin/env node` can pick up a bundled/editor Node, skip nvm, or fail entirely. Ambient resolution is not a safe contract here.

## Design

On `setup` / `migrate`, Grounder materializes this package's `dist/` at `~/.grounder/runtime/dist/` and points both host hook configs and installed skill markdown at:

```text
'<absolute process.execPath>' '<~/.grounder/runtime/dist/cli.js>' <subcommand> …
```

No registry fetch and no reliance on `PATH` at invocation time. Paths are shell-quoted (`shellQuote` in `agents/hook-runtime.ts`).

### Materialization modes

| Source | Mode | Stay current |
| --- | --- | --- |
| Durable (monorepo checkout, global install, linked dep) | Symlink `dist/` to source | Upgrade / `pnpm build` overwrites in place — no re-run needed |
| Ephemeral (bare `npx`, version-keyed cache) | Copy `dist/`, `package.json`, and `templates/` (if present) | Re-run `grounder migrate` (or `setup`) after upgrading |

Copy mode needs `package.json` and `templates/` alongside `dist/`, not just `dist/` itself: `src/index.ts` reads `VERSION` from `<pkgRoot>/package.json` eagerly at import, and `home-skills.ts` reads `<pkgRoot>/templates` on demand (`desiredArtifacts()`, and the drift check `status`/`doctor`/`peek` run). Symlink mode needs neither copied, since Node resolves `import.meta.url` through `dist/`'s own symlink back to the real package root — and it actively removes any copy-mode siblings a prior install left behind, so a symlinked `dist/` never ends up with stale siblings next to it.

All artifacts (`dist/`, and in copy mode, `package.json` / `templates/`) are staged first, then promoted together (`installArtifacts` in `agents/hook-runtime.ts`) — a promote failure after an earlier artifact has already promoted rolls that artifact back too, rather than leaving it and the failed one in a mixed state. This isn't a true single filesystem transaction (POSIX has no atomic rename across independent paths), but it also self-heals regardless: the manifest is only written after every artifact succeeds, so any failed upgrade leaves the old (mismatched) manifest version in place, which the next `isHookRuntimeStale` check reads as stale and retries.

Session hooks stay fast and side-effect-free: they never self-heal the runtime. Refresh is an explicit, idempotent install step.

### Runtime manifest (`~/.grounder/runtime/manifest.json`)

Written next to the materialized runtime for debugging and staleness checks (`isHookRuntimeStale`):

| Field | Meaning |
| --- | --- |
| `mode` | `"symlink"` or `"copy"` |
| `version` | Package version that wrote the runtime |
| `sourcePackageRoot` | Absolute path of the package root used as source |
| `installedAt` | ISO timestamp |

There is **no** `nodePath` field. The interpreter is baked into each hook/command string, not stored in the manifest. Staleness compares runtime materialization (mode / source / version), not the Node binary path.

## Repair loop

`setup` / `migrate` already recompute invocation strings against the *current* `process.execPath`. If a hook or command file still matches what Grounder last wrote (hash-safe for commands; owned rewrite for hooks), a Node switch + migrate rewrites the baked path. That repair worked before the doctor check existed.

The remaining gap was detection: after `nvm uninstall` (or similar) of the Node that was active at last install, artifacts can point at a missing binary until the user happens to re-run migrate.

### Drift checks must not use the *checking* process's own interpreter path

The repair loop above only works because `reconcile()`'s ledger-vs-disk hash comparison is invoker-specific by design: the ledger's per-file `hash` records the exact bytes (including the baked interpreter path) that `setup`/`migrate` actually wrote, and both real writes and disk reads compare on that same raw basis. That is correct for the *write* path — but the same "just re-render against `process.execPath`" logic, applied naively to a *read-only* check, produces a false positive: a different process (say, an editor extension host spawning the CLI under its own Electron binary, vs. a terminal's plain node) always renders a different string than whatever a terminal last installed, so a cheap hash-only comparison never converges across processes with different `execPath`s.

The fix is not to normalize the hash (hashes aren't invertible, and normalizing the ledger's stored hash would break the on-disk safety check above). Instead, `AgentLedgerEntry.lastInvocation` (`connector/state.ts`) records the exact invocation string used at each agent's last real install. `commands/install-drift.ts`'s cheap check (`status`/`peek`) passes that stored value as `desiredArtifacts()`'s `options.invocation`, re-rendering "desired" content byte-identical to what was actually last written — so its hash matches the ledger's existing `hash` field regardless of which process is asking. `commands/apply.ts` (the real `setup`/`migrate` write path) and `commands/doctor.ts` (which must mirror exactly what a real `migrate` would do) never pass this override — they always use the live process's own `process.execPath`, which is what preserves the node-switch repair loop described above.

| Call site | Renders against | Why |
| --- | --- | --- |
| `commands/apply.ts` (`setup`/`migrate`) | Live `process.execPath` | Must detect a Node switch as real drift, to repair it |
| `commands/doctor.ts` (`computeAgentPlan`) | Live `process.execPath` | Must show the same plan a real `migrate` would apply |
| `commands/install-drift.ts` (`status`/`peek`) | `lastInvocation` from the ledger (falls back to live `process.execPath` for a ledger predating the field) | Must not manufacture drift purely because a different process is asking |

## Doctor: dangling interpreter

When an already-installed Grounder hook entry or skill file matches the runtime invocation shape, doctor extracts the leading absolute Node path (`extractRuntimeNodePath` / `findRuntimeNodePathsInText`) and checks executability (`isExecutable` — `X_OK` on POSIX; Windows degrades toward existence).

| Case | Severity |
| --- | --- |
| Interpreter missing or not executable | **fail** + `grounder migrate` |
| Different absolute Node than current `process.execPath`, but still executable | **ok** (not broken) |
| Legacy `npx grounder …` shape (no absolute interpreter) | Skip — no false parse of `npx` as a path |
| Agent never opted into hooks / no command files | Unchanged warn / existing checks — dangling-Node never turns “absent” into a fail |

Same split as schema checks: present-but-broken fails; never-installed warns.

This is a read-only diagnostic over artifact content. It does not change the rendered template's hash — the generated string *shape* did not change, so the reconciler still sees the file as current (or as a normal drift case, if it also differs from the template).

## Key code map

| Concern | Location |
| --- | --- |
| Runtime materialization + quoting + parsers | `agents/hook-runtime.ts` |
| Command template `{{GROUNDER_CLI}}` substitution | `desiredArtifacts()` in `agents/home-skills.ts` (shared by `agents/cursor.ts` / `agents/claude.ts`) |
| Doctor dangling-Node checks | `commands/doctor.ts` |
| Executability helper | `util/fs.ts` (`isExecutable`) |
| Last-installed invocation, replayed by the cheap drift check | `AgentLedgerEntry.lastInvocation` / `recordedInvocation()` / `setLedgerInvocation()` in `connector/state.ts` |

## Rejected alternatives

- **Bare `node` / `#!/usr/bin/env node` on PATH** — editor hook PATH is undocumented and unreliable (minimal GUI/`launchd` PATH; Cursor can prepend its own Node; Claude Code non-login `sh -c` often skips nvm unless users source it manually). Baking an absolute interpreter and repairing explicitly matches VS Code/JetBrains interpreter settings and Corepack-style shims.
- **Store `nodePath` on the runtime manifest** — never consulted by staleness; the path that matters lives in the rendered hook/command strings. Removed rather than kept as dead state.
- **Stable `~/.grounder/runtime/bin/node` symlink** (deferred / rejected for v1) — the symlink target can go dangling the same way, so doctor still needs an existence/executability check; file symlinks add Windows privilege / Developer Mode cost that directory junctions for `dist/` do not. No behavioral gain over the existing content-hash repair loop.
- **Normalize `{{GROUNDER_CLI}}` out of the hash instead of replaying `lastInvocation`** — considered for the cheap-check false positive above. Doesn't work: hashes aren't invertible, so a normalized "desired" hash can only ever match a normalized *ledger* hash, but the ledger's `hash` field must stay raw (it's what `reconcile()`'s on-disk safety check compares against real, un-normalized disk bytes to tell "Grounder wrote this, safe to update" from "user-edited, conflict"). Normalizing the ledger's stored hash instead would make every real, unmodified file compare unequal to on-disk bytes forever (permanent false conflicts). Replaying the exact last-used invocation sidesteps this: no hash ever needs to be anything but the plain hash of real content.
