---
name: grounder-setup
description: >-
  Sets up, verifies, upgrades, or repairs Grounder — the CLI that links a
  project to a local markdown vault for agent memory (Obsidian-compatible).
  Use when the user asks to install Grounder, set up, upgrade, or repair
  Grounder, run grounder setup, link this project to their vault or Obsidian
  vault, or when Grounder slash commands, handoffs, or session memory are
  missing.
---

# Grounder setup

Drive the native Grounder CLI to preview, install, verify, and repair Grounder.

Adding this skill only loads these instructions. Running it is what installs the CLI (if missing), slash commands, and hooks.

## Boundary

- Delegate writes to the CLI. Do not copy command files, edit `~/.grounder/config.json` by hand, or invent repair steps.
- Do not pass `--agent` unless the user asks to **limit** the install. Auto-detect should install every detected host (Cursor and Claude Code).
- Never `--force` on first setup. Never `--force` a vault-root change (home config pointing at a different vault is a conflict to surface, not overwrite).
- Always preview writes in chat and get approval. For `setup` / `link` / `migrate`, say the `Step N of 4` line (section 4), run `--dry-run`, and show that stdout as-is — do not reconstruct the write list. Then apply (`--yes` on setup/link; `migrate` has no confirm). Never rely on the interactive `confirm()` prompt — it treats empty stdin as yes, so a non-TTY agent shell would apply unaudited. No extra confirmation gates.
- Do not write a test note or handoff unless asked.
- Skill present ≠ Grounder ready.

The vault and `~/.grounder` live outside the project directory. If the host prompts for a permission scope, grant access to those two specific paths — the CLI needs to read and write there.

## 1. Environment and Grounder CLI

Steps 1–2 of the board. Prefer a real global CLI so `grounder setup` can symlink `~/.grounder/runtime` (tracks upgrades). Bare `npx grounder setup` copies the runtime and needs `migrate` after every upgrade.

1. Check Node 18+ (`node -v`). If missing or too old: print the board with step 1 needed and stop — do not install Node.
2. If `grounder --version` (or `command -v grounder`) works, use `grounder` for every later command.
3. If missing: print the board with step 2 needed and **ask** before `npm install -g grounder`. Never silently install a global package. Default `npm`; offer `pnpm add -g grounder` only when that is clearly the user's toolchain.
4. If they decline: use `npx grounder` as bootstrap, mark step 2 `using npx`, and tell them the runtime will be a copy until they install globally.

Call the resolved binary `GROUNDER` below (`grounder` or `npx grounder`). Do not hard-code one or the other.

## 2. State check

This skill always targets `pwd` (the folder that will get `.grounder.json`). Run checks first; the first user-visible message is the progress board (below), not a diagnostic paragraph.

Run `$GROUNDER status`. `status`/`doctor` walk up from `pwd` to the nearest `.grounder.json` (stopping at the git root), so a subdirectory of an already-linked repo can report `Linked: yes` for an *ancestor* folder, not `pwd` itself. Before trusting `Linked:`, check:

- `Folder:` equals `pwd` exactly, **and**
- there is no `Note: linked ancestor …` line (status) / no `— ancestor of … this folder itself is unlinked` suffix on `repo-config` (doctor).

If either signal shows an ancestor link, treat `pwd` as **unlinked**, no matter what `Linked:` says — do not run doctor's hinted fix command in the ancestor folder; you were asked to set up `pwd`, not its parent.

This exact folder is **linked** (step 4 `done`) when `Linked: yes` and `Folder:` == `pwd`. `Linked: no`, or an ancestor-only link, is **unlinked** (step 4 `needed`). Missing Connect does not change that.

- Home exists but project unlinked (including "linked via an ancestor only"): also run `$GROUNDER doctor --global` (repair the machine first if it fails).
- Project linked to *this exact folder* (`Linked: yes` and `Folder:` == `pwd`): run `$GROUNDER doctor` when home exists; if home is missing/invalid, skip doctor and go to first-time `setup` (Link stays `done`).
- No usable home config yet (`Config: missing` **or** `Config: invalid` → grounder setup): skip `doctor --global` — `status` already gives the fix. `setup` recreates a missing *or* corrupt `~/.grounder/config.json` on its own (no manual delete, no `--force`) — treat `invalid` exactly like `missing` and proceed straight to first-time `setup`.

Then branch — do not always run both inits:

| State | Action |
|---|---|
| No usable home config (`Config: missing` or `invalid` → `grounder setup`) | Resolve vault path → first-time `setup` → `link` if the project is unlinked |
| Home exists, project unlinked (or only linked via an ancestor folder) | `link` only (repair the machine first if `doctor --global` failed) |
| Linked to this exact folder and `doctor` exits 0 | Report notes/logs/plans paths and stop |
| Linked to this exact folder, but `doctor` exits 1 | Run the command after `→` in the failing check (section 5) |

`doctor` exit 1 means a `fail` check. `warn` (including missing hooks **and** missing `notes/` / `logs/` / `plans/`) is not a failure. Those three layout dirs `mkdir` on first note/handoff/plan write — do not preview `link` for them. An ancestor-link note is never itself something to fix — it means run `link` in `pwd`.

Map `doctor --global` failures onto step 3 (Connect) — e.g. missing `10-Projects/` is Connect needed, not a separate story.

## Progress board

After sections 1–2, print this board once (every path, including already-done and repair). Fill `{…}` from checks you already ran. Do not dump `status`/`doctor` prose (`Home config already…`, `This folder is not linked.`, `doctor --global failed…`). Do not say `Dry-run of grounder …`.

```text
Setting up Grounder for `/pwd`.

Setup has four steps:
1. Environment — Node 18+ — {done (vX) | needed (install Node 18+ and re-run)}
2. Grounder — CLI on this machine — {done (vX) | needed | using npx}
3. Connect — markdown vault (once per machine) — {done (path) | needed | needed (`10-Projects/` missing)}
4. Link — this project (once per project) — {done | needed}
```

Then only the remaining steps, in order, using the `Step N of 4` lines in section 4.

After applying a step, say `Step N done.` Then re-run `$GROUNDER status` (and `$GROUNDER doctor` if this exact folder is now linked). Remaining writes come from **current** state — do not preview `link` just because the original board listed step 4, and do not follow doctor **warn** hints. If Link is `done`, skip `link` and go to section 6.

If 1–4 are all done, print the board, report notes/logs/plans paths, and stop.

Example (home exists, vault scaffold missing, project unlinked) — this is the whole first message, then wait:

```text
Setting up Grounder for `/path/to/project`.

Setup has four steps:
1. Environment — Node 18+ — done (v24.9.0)
2. Grounder — CLI on this machine — done (0.4.2)
3. Connect — markdown vault (once per machine) — needed (`10-Projects/` missing)
4. Link — this project (once per project) — needed

Step 3 of 4 — Connect to a markdown vault (once per machine). Preview:
```

Then paste `--dry-run` stdout as-is. Then: `Approve this and I’ll apply it. After that: step 4 (link this project).`

## 3. Vault path (first-time `setup` only)

`setup <path>` is once per machine. After `~/.grounder/config.json` exists, skip it (unless a later doctor hint says otherwise). `GROUNDER_VAULT` is a session override, not a setup input. `link` needs no path. Do not require `.obsidian`. The board already explained Connect vs Link — do not print a second intro.

Resolution order:

1. Path in the triggering message (e.g. “set up Grounder with ~/Documents/obsidian/dev”). Do not depend on host `$ARGUMENTS` being real.
2. Otherwise ask once, then wait. Do not proceed: "What's the path to your markdown vault?"
3. **Never guess** `~/Documents/Obsidian`, `~/obsidian`, or the current repo. A wrong `vaultRoot` is sticky machine state.

If the resolved path is missing: **warn** that `setup` will create that directory (`mkdir` of `10-Projects/` is recursive) and **ask how to proceed** — continue (create it), pick a different path, or abort.

## 4. Preview in chat, then apply

Before each `--dry-run`, say the matching line verbatim, then show that stdout in chat as-is — it's the real write list, do not restate or reconstruct it yourself. Wait for approval, then rerun the identical command with `--yes`. Add `--hooks` on a first-time `setup` unless declined. Never `--agent`, never `--force`. No extra confirmation gates beyond that approval. Do not mention `--yes` or `--dry-run` in chat.

| Command | Say (then paste stdout) |
|---|---|
| `setup` | Step 3 of 4 — **Connect** to a markdown vault (once per machine). Preview: |
| `link` | Step 4 of 4 — **Link this project** inside the markdown vault (once per project). Preview: |
| `migrate` | Repair — **Refresh Grounder after an upgrade.** Preview: |

If another setup step remains after this apply: `Approve this and I’ll apply it. After that: step 4 (link this project).` If this is the last remaining setup write: `Approve this and I’ll apply it.`

`link` reads `~/.grounder/config.json`, which `setup` creates — so `setup` must be fully applied (not just previewed) before you preview or apply `link`:

```bash
$GROUNDER setup <path> --hooks --dry-run
# → approve → $GROUNDER setup <path> --hooks --yes

$GROUNDER link --dry-run          # only if the project is still unlinked
# → approve → $GROUNDER link --yes
```

After Connect is applied, re-check before this preview. If the project is already linked, skip `link`. If `link --dry-run` prints `Already linked (would skip).`, treat step 4 as done — do not apply, do not wait for approval.

To preview `link` before `setup` is applied, add `--vault <path>` to `link --dry-run` — it resolves the vault path without needing the home config yet. If no supported agent is detected, still run `setup`: the home config and `10-Projects/` are useful without CLI/editor glue.

## 5. When doctor fails

First confirm doctor's `repo-config` check applies to `pwd` and not an ancestor folder (section 2) — never follow a fix hint that belongs to a folder other than `pwd`.

Do not invent a repair. Doctor already prints the fix after `→` on each `fail` line. Preview that command, get approval, then run it. Typical hints:

- `grounder migrate`
- `grounder migrate --hooks`
- `grounder migrate --force`
- `grounder link`
- `upgrade grounder`

These hints always print the literal word `grounder` — even if you're bootstrapping via `npx grounder`. Replace that prefix with your resolved `$GROUNDER` before running. Do not invent extra flags.

A corrupt `~/.grounder/state.json` (unlike a corrupt `config.json`, section 2) is not self-healing: doctor's `install-state` hint reads `fix or remove ~/.grounder/state.json, then grounder migrate --force`. That file-removal instruction is doctor-sanctioned, not an invented repair. Scope is a single, exact, named file: after explicit user approval, `rm` that one literal path only — no wildcards, no other files, never `config.json`, never anything doctor didn't name — then run the `grounder migrate --force` half of the hint.

`migrate` writes immediately (no confirm). Say the purpose line, then preview first:

```bash
$GROUNDER migrate --dry-run
```

Add the same flags doctor hinted (`--hooks`, `--force`). Then apply the non-dry-run command only after approval.

Never `--force` a vault-root change.

## 6. Verify

After `link` / repair, run `$GROUNDER doctor` (full, not `--global`). Report the notes/logs/plans paths (`status` or `$GROUNDER path notes` / `path logs` / `path plans`). Doctor exit 0 with warns (including missing notes/logs/plans) is done — report those paths and stop. Do not treat `→ grounder link` on a **warn** as remaining setup.

- If the repo is shared, mention that `.grounder.json` should be committed.
- Do not write a test note or handoff unless asked.
- Slash commands / teasers may need a **new session** to appear.
- Adapters without `installHooks` no-op; missing hooks is a `doctor` `warn`, not a failure.
- If this host has no Grounder adapter (Codex and Copilot have none): vault + CLI work; slash commands and teasers will not.
