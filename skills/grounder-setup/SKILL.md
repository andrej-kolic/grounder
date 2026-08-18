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
- Always preview writes in chat and get approval. For `vault init` / `init` / `migrate`, say the purpose line (section 4), run `--dry-run`, and show that stdout as-is — do not reconstruct the write list. Then apply (`--yes` on the inits; `migrate` has no confirm). Never rely on the interactive `confirm()` prompt — it treats empty stdin as yes, so a non-TTY agent shell would apply unaudited. No extra confirmation gates.
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

This skill always targets `pwd` — state that folder in chat before running anything (e.g. "Setting up Grounder for `/path/you/are/in`") so it's clear which folder will get `.grounder.json`, especially in a repo that already links a parent/sibling folder elsewhere.

Run `$GROUNDER status`. `status`/`doctor` walk up from `pwd` to the nearest `.grounder.json` (stopping at the git root), so a subdirectory of an already-linked repo can report `Linked: yes` for an *ancestor* folder, not `pwd` itself. Before trusting `Linked:`, check:

- `Folder:` equals `pwd` exactly, **and**
- there is no `Note: linked ancestor …` line (status) / no `— ancestor of … this folder itself is unlinked` suffix on `repo-config` (doctor).

If either signal shows an ancestor link, treat `pwd` as **unlinked**, no matter what `Linked:` says — do not run doctor's hinted fix command in the ancestor folder; you were asked to set up `pwd`, not its parent.

- Home exists but project unlinked (including "linked via an ancestor only"): also run `$GROUNDER doctor --global` (repair the machine first if it fails).
- Project linked to *this exact folder* (`Linked: yes` and `Folder:` == `pwd`): run `$GROUNDER doctor`.
- No usable home config yet (`Config: missing` **or** `Config: invalid` → grounder vault init): skip `doctor --global` — `status` already gives the fix. `vault init` recreates a missing *or* corrupt `~/.grounder/config.json` on its own (no manual delete, no `--force`) — treat `invalid` exactly like `missing` and proceed straight to first-time `vault init`.

Then branch — do not always run both inits:

| State | Action |
|---|---|
| No usable home config (`Config: missing` or `invalid` → `grounder vault init`) | Resolve vault path → first-time `vault init` → `init` if the project is unlinked |
| Home exists, project unlinked (or only linked via an ancestor folder) | `init` only (repair the machine first if `doctor --global` failed) |
| Linked to this exact folder and `doctor` exits 0 | Report notes/logs/plans paths and stop |
| Linked to this exact folder, but `doctor` exits 1 | Run the command after `→` in the failing check (section 5) |

`doctor` exit 1 means a `fail` check. `warn` (including missing hooks) is not a failure. An ancestor-link note is never itself something to fix — it means run `init` in `pwd`.

## 3. Vault path (first-time `vault init` only)

`vault init <path>` is once per machine. After `~/.grounder/config.json` exists, skip it (unless a later doctor hint says otherwise). `GROUNDER_VAULT` is a session override, not a setup input. `init` needs no path. Do not require `.obsidian`.

Before first-time `vault init`, say this once (even if the path is already known):

```text
Setup has two steps:
1. Connect to a markdown vault (once; Obsidian not required). That's the vault root — Grounder creates `10-Projects/` inside it; notes, logs, and plans live under each project.
2. Link this project inside that vault (once per project)
```

Resolution order:

1. Path in the triggering message (e.g. “set up Grounder with ~/Documents/obsidian/dev”). Do not depend on host `$ARGUMENTS` being real.
2. Otherwise ask once, then wait. Do not proceed: "What's the path to your markdown vault?"
3. **Never guess** `~/Documents/Obsidian`, `~/obsidian`, or the current repo. A wrong `vaultRoot` is sticky machine state.

If the resolved path is missing: **warn** that `vault init` will create that directory (`mkdir` of `10-Projects/` is recursive) and **ask how to proceed** — continue (create it), pick a different path, or abort.

## 4. Preview in chat, then apply

Before each `--dry-run`, say the matching purpose line verbatim, then show that stdout in chat as-is — it's the real write list, do not restate or reconstruct it yourself. Wait for approval, then rerun the identical command with `--yes`. Add `--hooks` on a first-time `vault init` unless declined. Never `--agent`, never `--force`. No extra confirmation gates beyond that approval.

| Command | Say (then paste stdout) |
|---|---|
| `vault init` | **Connect** to a markdown vault (once per machine). Records the path, creates `10-Projects/`, installs slash commands. Preview: |
| `init` | **Link this project** inside the markdown vault (once per project). Writes `.grounder.json` and creates `10-Projects/{projectId}/notes`, `logs`, and `plans`. Preview: |
| `migrate` | **Refresh Grounder after an upgrade.** Updates slash commands/hooks; does not change the vault path. Preview: |

`init` reads `~/.grounder/config.json`, which `vault init` creates — so `vault init` must be fully applied (not just previewed) before you preview or apply `init`:

```bash
$GROUNDER vault init <path> --hooks --dry-run
# → approve → $GROUNDER vault init <path> --hooks --yes

$GROUNDER init --dry-run          # only if the project is still unlinked
# → approve → $GROUNDER init --yes
```

To preview `init` before `vault init` is applied, add `--vault <path>` to `init --dry-run` — it resolves the vault path without needing the home config yet. If no supported agent is detected, still run `vault init`: the home config and `10-Projects/` are useful without CLI/editor glue.

## 5. When doctor fails

First confirm doctor's `repo-config` check applies to `pwd` and not an ancestor folder (section 2) — never follow a fix hint that belongs to a folder other than `pwd`.

Do not invent a repair. Doctor already prints the fix after `→` on each `fail` line. Preview that command, get approval, then run it. Typical hints:

- `grounder migrate`
- `grounder migrate --hooks`
- `grounder migrate --force`
- `grounder init`
- `upgrade grounder`

These hints always print the literal word `grounder` — even if you're bootstrapping via `npx grounder`. Replace that prefix with your resolved `$GROUNDER` before running. Do not invent extra flags.

A corrupt `~/.grounder/state.json` (unlike a corrupt `config.json`, section 2) is not self-healing: doctor's `install-state` hint reads `fix or remove ~/.grounder/state.json, then grounder migrate --force`. That file-removal instruction is doctor-sanctioned, not an invented repair — get approval, `rm` exactly that path (never `config.json`, never anything doctor didn't name), then run the `grounder migrate --force` half of the hint.

`migrate` writes immediately (no confirm). Say the purpose line, then preview first:

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
