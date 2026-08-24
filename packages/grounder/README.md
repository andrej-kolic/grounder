# Grounder

**Obsidian vault memory for Cursor and Claude Code.**  
Session handoffs, plans, and notes in files you own.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/andrej-kolic/grounder/main/docs/assets/what-dark.svg">
  <img alt="Grounder connects Cursor, Claude Code, and more agents to one markdown vault through slash commands and the CLI. The vault is a folder tree: 10-Projects/your-project/ containing plans (updated in place), notes (one-off), and logs (session handoffs). Caption: Any agent. One vault. Only when you ask." src="https://raw.githubusercontent.com/andrej-kolic/grounder/main/docs/assets/what.svg">
</picture>

<p>&nbsp;</p>

[![npm version](https://img.shields.io/npm/v/grounder.svg)](https://www.npmjs.com/package/grounder)
[![license](https://img.shields.io/npm/l/grounder.svg)](https://github.com/andrej-kolic/grounder/blob/main/LICENSE)

**Grounder** keeps your agent's memory in plain markdown inside a folder you control — an
Obsidian vault, or any directory on disk. Because it's files instead of chat history, work
started in Cursor can be picked up in Claude Code, weeks later, on a different machine.

## The problem

- **Sessions start cold.** Every new chat re-derives what the last one already worked out.
- **Tools don't share memory.** What you figured out in Claude Code is invisible to Cursor, and the other way around.
- **You can't find the plan.** Implementation plans and decisions end up buried in a chat transcript, or in whatever directory some tool chose for you.

## What you get

- **Files, not a service** — no database, no vectors, no MCP server, no daemon, no background indexing. Read them, diff them, delete them.
- **One vault, every project** — each linked project gets its own folder. A git repo or a plain folder both work.
- **Plans live, sessions accumulate** — a plan updates in place across sessions; notes and handoffs are dated files you can always go back to. `search` ranks across all of them.
- **Deliberate** — nothing is read or written until you run a command. No auto-capture, no RAG, no tokens spent otherwise.
- **Follows you across machines** — the vault is just a folder, so git (or Syncthing, or Dropbox) is all the sync you need.
- **Cursor and Claude Code today** — slash commands for both; more agents on the [roadmap](#roadmap).

**Requirements:** Node.js 18+ and a folder to keep the files in — an existing Obsidian
vault, or an empty directory Grounder fills as you go. Git is optional.

## Install

```bash
npm install -g grounder
```

Or let an agent do the whole install and setup for you:

```bash
npx skills add andrej-kolic/grounder --skill grounder-setup -g
```

Adding the skill only loads instructions — it does **nothing** until you ask your agent to
run it (e.g. "set up grounder"). You can also skip the global install with
`npx grounder --help`, at the cost of re-running `grounder migrate` after each upgrade.

`grounder -h` prints a short synopsis, `grounder --help` the full reference, and
`grounder -v` the installed version.

## Quickstart

```bash
# Once per machine — connect to a vault + install agent slash commands
grounder setup <path-to-your-vault> --hooks

# Once per project folder
cd your-project
grounder link
```

Both commands preview what they'll write and ask to confirm. Add `--yes` to skip the
prompt or `--dry-run` to see the preview without writing. `--hooks` is optional and adds a
one-line reminder at session start when a handoff exists — see
[session-start hooks](https://github.com/andrej-kolic/grounder/blob/main/docs/session-hooks.md).

Then work from your agent's chat. A session usually recalls first and checkpoints last;
what happens in between is up to you. Below, `>` lines are what you type, `←` is what the
agent read, and `→` is what it wrote:

```text
> /grounder-task
  ← read logs/2026-07-21-091500-auth-middleware.md + AGENTS.md
    "Last session mapped the middleware order. Next: tests for the 401 path."

> /grounder-plan auth rewrite: 401 tests pass, validator swap is next
  → wrote plans/auth-rewrite.md

> /grounder-search how did we handle token refresh before
  ← ranked the project vault, full-read the top 4 hits, answered inline

> /grounder-task-handoff
  → wrote logs/2026-07-28-143200-auth-middleware.md
```

The text after a slash command is an instruction, not file content — the agent turns it
into the section structure Grounder expects. `/grounder-task` and `/grounder-task-handoff`
need no text at all.

| Command                  | What it does                                        | CLI it runs                    |
| ------------------------ | --------------------------------------------------- | ------------------------------ |
| `/grounder-task`         | Pick up where the last session stopped              | `grounder handoff list --head` |
| `/grounder-plan`         | Write or update a living plan that spans sessions   | `grounder plan`                |
| `/grounder-search`       | Find prior context anywhere in this project's vault | `grounder search`              |
| `/grounder-note`         | Save a one-off note                                 | `grounder note`                |
| `/grounder-task-handoff` | Checkpoint the session before you close it          | `grounder handoff`             |

## How it works

<!-- DIAGRAM 2 — docs/assets/how.svg, absolute URL when it exists (see note above). -->

Three things, and that's the whole model:

1. **One vault per machine.** `grounder setup` records the vault path in
   `~/.grounder/config.json`. Nothing else on the machine needs to know where it is.
2. **One folder per project.** `grounder link` writes a two-line `.grounder.json`
   (safe to commit) into the project and creates the matching folder in the vault. That
   marker is how every later command knows where to read and write.
3. **Three document types**, each with a fixed shape so agents produce consistent files:

```text
10-Projects/your-project/
├── notes/
│   └── 2026-07-21-auth-investigation.md      ← one-off, always a new file
├── logs/
│   ├── 2026-07-21-091500-auth-middleware.md  ← one handoff per session
│   └── 2026-08-14-103000-auth-middleware.md
└── plans/
    └── auth-rewrite.md                       ← living: updated in place
```

`10-Projects/` is PARA naming, so Grounder slots into an existing Obsidian vault instead
of fighting it. A **handoff** is the checkpoint one session leaves for the next — what got
done, what's next, what's blocked — and they live under `logs/` because you accumulate one
per session. `/grounder-task` resumes the newest usable handoff by default, but you can
name any earlier session instead.

Here's the living plan, `plans/auth-rewrite.md`:

```markdown
---
project: "your-project"
created: "2026-07-21T09:15:00Z"
updated: "2026-08-14T10:30:00Z"
topics: ["auth", "middleware", "jwt"]
---

## Goal
Ship the auth rewrite before Q3 cutover.

## Steps
- [x] Map current middleware order
- [ ] Add tests for the 401 path
- [ ] Swap in new token validator
```

`created` and `updated` are different dates — the plan survived a second session, in the
same agent or a different one, on the same machine or another. Obsidian renders that
frontmatter as Properties, so it's browsable and queryable without plugins.

## Commands

No agent, or want to write by hand? Every slash command is a plain CLI command:

```bash
grounder plan $'# Goal\n\nShip it' --title auth-rewrite   # living plan
grounder note "Investigate auth middleware"               # one-off note
grounder handoff $'# Handoff: ...\n\n## Next\n1. ...'     # session checkpoint
grounder search "token refresh"                           # rank matching files
grounder plan list                                        # also: note list, handoff list
grounder status                                           # am I wired up?
grounder doctor                                           # why isn't this working?
```

Full flags and behavior: **[CLI reference](https://github.com/andrej-kolic/grounder/blob/main/docs/cli-reference.md)**.

## Demo

![A session loop: peek teaser, /grounder-task resume, /grounder-plan list, continuing a plan, /grounder-note, /grounder-task-handoff — each with the real grounder CLI call it runs and the vault path it touches](https://raw.githubusercontent.com/andrej-kolic/grounder/main/packages/demo-casts/out/readme.gif)

Dim lines in the GIF are the real `grounder` CLI call behind each slash command.

## FAQ

**How is this different from `AGENTS.md` or `CLAUDE.md`?**

Those are instructions you write once: stable rules about the project. Grounder stores
what accumulates: what happened last session, what's next, the plan currently in flight.
They're complements — `/grounder-task` reads the newest handoff *and* `AGENTS.md`.

**Is this an MCP server?**

No. It's a CLI plus slash command files. Nothing is registered with your agent, nothing
runs in the background, and no tokens are spent until you type a command.

**Do I need Obsidian?**

No — any directory works. Obsidian is just a nice reader for it: frontmatter shows up as
Properties, and you get search and backlinks for free.

**Does it work across machines?**

Yes, if your vault does. Make the vault a git repo (or use Syncthing, Dropbox, iCloud) and
your agent memory follows you. `grounder setup` is per machine; `.grounder.json` travels
with the project.

**What does it put in my repo?**

Only `.grounder.json` — two lines, safe to commit. Slash commands go under `~/.cursor` and
`~/.claude`; vault content stays outside the project tree entirely.

**Does it capture my conversations automatically?**

No. Nothing is written or loaded unless you ask. That's the point.

## Docs

- [CLI reference](https://github.com/andrej-kolic/grounder/blob/main/docs/cli-reference.md) — every command and flag
- [Configuration](https://github.com/andrej-kolic/grounder/blob/main/docs/configuration.md) — machine config, `.grounder.json`, env vars, agent adapters
- [Upgrading](https://github.com/andrej-kolic/grounder/blob/main/docs/upgrading.md) — run `grounder migrate` after a package upgrade
- [Session-start hooks](https://github.com/andrej-kolic/grounder/blob/main/docs/session-hooks.md) — the opt-in handoff teaser
- [Troubleshooting](https://github.com/andrej-kolic/grounder/blob/main/docs/troubleshooting.md) — symptom → fix

## Roadmap

- **Support for Copilot, Codex, and other popular agents** — expand beyond Cursor and Claude Code so more agent tools can use the same vault memory.
- **Auto-draft handoff on session end** (under consideration) — a hook that has the agent write the same structured Done/Next/Blockers checkpoint automatically, instead of requiring `/grounder-task-handoff`.

## Development

Source, tests, and contribution workflow live in the
[Grounder monorepo](https://github.com/andrej-kolic/grounder).

## License

[MIT](https://github.com/andrej-kolic/grounder/blob/main/LICENSE)
