---
name: grounder-setup
description: >-
  Sets up, verifies, upgrades, or repairs Grounder — the CLI that links a
  project to a local markdown vault for agent memory. Use when the user asks
  to install Grounder, set up, upgrade, or repair Grounder, run vault init,
  link this project to their vault, or when Grounder slash commands,
  handoffs, or session memory are missing.
---

# Grounder setup

Drive the native Grounder CLI to preview, install, verify, and repair Grounder.

Adding this skill only loads these instructions. Running it is what installs the CLI (if missing), slash commands, and hooks.

## Boundary

- Delegate writes to the CLI. Do not copy command files, edit `~/.grounder/config.json` by hand, or invent repair steps.
- Do not pass `--agent` unless the user asks to **limit** the install. Auto-detect should install every detected host (Cursor and Claude Code).
- Never `--force` on first setup. Never `--force` a vault-root change (home config pointing at a different vault is a conflict to surface, not overwrite).
- Always preview writes in chat and get approval, then apply `vault init` / `init` with `--yes`. Never rely on the interactive `confirm()` prompt — it treats empty stdin as yes, so a non-TTY agent shell would apply unaudited. `migrate` has no confirm prompt; preview with `--dry-run` first.
- Do not write a test note or handoff unless asked.
- Skill present ≠ Grounder ready.

The vault and `~/.grounder` live outside the project. Grant the shell whatever unrestricted / `all` permissions the host requires so those paths are reachable.

## 1. CLI on PATH

Prefer a real global CLI so `vault init` can symlink `~/.grounder/runtime` (tracks upgrades). Bare `npx grounder vault init` copies the runtime and needs `migrate` after every upgrade.

1. Check Node 18+ (`node -v`). If Node is missing or too old, stop — do not install Node.
2. If `grounder --version` (or `command -v grounder`) works, use `grounder` for every later command.
3. If missing: **ask** before `npm install -g grounder`. Never silently install a global package. Default `npm`; offer `pnpm add -g grounder` only when that is clearly the user's toolchain.
4. If they decline: use `npx grounder` as bootstrap, and tell them the runtime will be a copy until they install globally.

Call the resolved binary `GROUNDER` below (`grounder` or `npx grounder`). Do not hard-code one or the other.

## 2. State check

Run `$GROUNDER status`.

- Home exists but project unlinked: also run `$GROUNDER doctor --global` (repair the machine first if it fails).
- Project already linked (`Linked: yes`): run `$GROUNDER doctor`.
- No home config yet: skip `doctor --global` — `status` already gives the fix (`Config: missing → grounder vault init`).

Then branch — do not always run both inits:

| State | Action |
|---|---|
| No home config (`Config: missing → grounder vault init`) | Resolve vault path → first-time `vault init` → `init` if the project is unlinked |
| Home exists, project unlinked | `init` only (repair the machine first if `doctor --global` failed) |
| Linked and `doctor` exits 0 | Report notes/logs/plans paths and stop |
| Already set up, but `doctor` exits 1 | Run the command after `→` in the failing check (section 5) |

`doctor` exit 1 means a `fail` check. `warn` (including missing hooks) is not a failure.

## 3. Vault path (first-time `vault init` only)

`vault init <path>` is once per machine. After `~/.grounder/config.json` exists, skip it (unless a later doctor hint says otherwise). `GROUNDER_VAULT` is a session override, not a setup input. `init` needs no path.

Resolution order:

1. Path in the triggering message (e.g. “set up Grounder with ~/Documents/obsidian/dev”). Do not depend on host `$ARGUMENTS` being real.
2. Ask once: "What's the path to your Obsidian vault?" Wait. Do not proceed.
3. **Never guess** `~/Documents/Obsidian`, `~/obsidian`, or the current repo. A wrong `vaultRoot` is sticky machine state.

If the resolved path is missing: **warn** that `vault init` will create that directory (`mkdir` of `10-Projects/` is recursive) and **ask how to proceed** — continue (create it), pick a different path, or abort. Do not require `.obsidian`; Grounder is Obsidian-compatible, not Obsidian-only.

## 4. Preview in chat, then apply

Show the writes in chat and wait for approval. Then apply with `--yes`. Include `--hooks` on first-time setup unless the user declines. No `--agent`, no `--force`.

First-time machine setup:

```bash
$GROUNDER vault init <path> --hooks --yes
```

Omit `--hooks` if they declined. Then, if the project is still unlinked:

```bash
$GROUNDER init --yes
```

`vault init` writes:

- `~/.grounder/config.json` (`vaultRoot`)
- `<vault>/10-Projects/` if missing
- `~/.grounder/runtime` when any agent is detected
- slash commands (and `--hooks` teasers) for each **detected** agent

`init` writes:

- `.grounder.json` in the current project folder (`projectId` — safe to commit)
- `<vault>/10-Projects/<projectId>/{notes,logs,plans}/`

If no supported agent is detected, still run `vault init` (home config + `10-Projects/` are useful without glue).

## 5. When doctor fails

Do not invent a repair. Doctor already prints the fix after `→` on each `fail` line. Preview that command, get approval, then run it. Typical hints:

- `grounder migrate`
- `grounder migrate --hooks`
- `grounder migrate --force`
- `grounder init`
- `upgrade grounder`

These hints always print the literal word `grounder` — even if you're bootstrapping via `npx grounder`. Replace that prefix with your resolved `$GROUNDER` before running. Do not invent extra flags.

`migrate` writes immediately (no confirm). Preview first:

```bash
$GROUNDER migrate --dry-run
```

Add the same flags doctor hinted (`--hooks`, `--force`). Then apply the non-dry-run command only after approval.

Never `--force` a vault-root change.

## 6. Verify

After `init` / repair, run `$GROUNDER doctor` (full, not `--global`). Report the notes/logs/plans paths (`status` or `$GROUNDER path notes` / `path logs` / `path plans`).

- If the repo is shared, mention that `.grounder.json` should be committed.
- Do not write a test note or handoff unless asked.
- Slash commands / teasers may need a **new session** to appear.
- Adapters without `installHooks` no-op; missing hooks is a `doctor` `warn`, not a failure.
- If this host has no Grounder adapter (Codex and Copilot have none): vault + CLI work; slash commands and teasers will not.
