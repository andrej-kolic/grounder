/** Help tiers and command metadata for the grounder CLI. */

export type HelpGroup = "Setup" | "Write" | "Retrieve" | "Paths" | "Maintain" | "Advanced";

export interface CommandMeta {
  /** Canonical id (`note`, `handoff list`, `setup`, …). */
  id: string;
  group: HelpGroup;
  /** One-line summary for synopsis / full command lists. */
  summary: string;
  /** Usage line shown in per-command help (no `Usage:` prefix). */
  usage: string;
  /** Synopsis / full-list left column (no `grounder ` prefix). */
  listUsage: string;
  /** Flag / detail block for per-command help. */
  flags?: string;
  /** Include in synopsis and full command lists (default true). */
  list?: boolean;
}

const GROUP_ORDER: HelpGroup[] = ["Setup", "Write", "Retrieve", "Paths", "Maintain", "Advanced"];

const QUICKSTART = `Quickstart:
  grounder setup <path-to-your-vault>
  grounder link
  grounder note "my first note"
  grounder handoff $'# Handoff\\n\\n## Next\\n1. …'
  grounder handoff list
  grounder plan $'# Goal\\n\\nShip it' --title phase-1
  grounder plan list`;

/**
 * Single registry driving synopsis, full help, and per-command help so they
 * cannot drift from each other (or from the dispatcher ids).
 */
export const COMMANDS: readonly CommandMeta[] = [
  {
    id: "setup",
    group: "Setup",
    summary: "Connect to a markdown vault (once per machine)",
    listUsage: "setup <path>",
    usage: "grounder setup <path> [--yes] [--force] [--agent <id>] [--hooks] [--dry-run]",
    flags: `Flags:
  --yes          Skip confirmation prompts
  --force        Overwrite existing home config / generated files
  --agent <id>   Install for a specific agent (repeatable; default: auto-detect)
                 Supported: cursor, claude
  --hooks        Also install session-start teaser hooks
  --dry-run      Preview without writing`,
  },
  {
    id: "link",
    group: "Setup",
    summary: "Link this project inside the markdown vault (once per project)",
    listUsage: "link",
    usage: "grounder link [--yes] [--force] [--id <id>] [--vault <path>] [--dry-run]",
    flags: `Flags:
  --yes          Skip confirmation prompts
  --force        Overwrite an existing link marker
  --id <id>      Override detected project id
  --vault <path> Override home vault root for this run
  --dry-run      Preview without writing`,
  },
  {
    id: "note",
    group: "Write",
    summary: "Write a note to the vault",
    listUsage: "note <text>",
    usage: "grounder note <text> [--title <slug>] [--topics <list>]",
    flags: `Flags:
  --title <slug>  Short slug in filename (default: slugified first line)
  --topics <list> Comma-separated keywords for search (e.g. "auth,jwt,session")

Subcommands:
  note list   Print recent notes under notes/** (bucket-relative titles, newest first)`,
  },
  {
    id: "note list",
    group: "Write",
    summary: "Print recent notes under notes/** (bucket-relative titles, newest first)",
    listUsage: "note list",
    usage: "grounder note list [--limit <n>] [--markdown]",
    flags: `Flags:
  --limit <n>  Max notes to print (default: 5)
  --markdown   Agent relay: [bucketRelativePath](fileUri) title lines
               (lists notes/**; nested e.g. feature/name.md)`,
  },
  {
    id: "handoff",
    group: "Write",
    summary: "Write a session handoff to vault logs/",
    listUsage: "handoff <text>",
    usage: "grounder handoff <text> [--title <slug>] [--topics <list>]",
    flags: `Flags:
  --title <slug>  Short slug in filename (default: slugified first line)
  --topics <list> Comma-separated keywords for search (e.g. "auth,jwt,session")

Subcommands:
  handoff list   Print recent handoffs under logs/** (bucket-relative titles, newest first)
  handoff peek   One-line latest-handoff teaser (session hooks)`,
  },
  {
    id: "handoff list",
    group: "Write",
    summary: "Print recent handoffs under logs/** (bucket-relative titles, newest first)",
    listUsage: "handoff list",
    usage: "grounder handoff list [--limit <n>] [--head] [--markdown]",
    flags: `Flags:
  --limit <n>  Max handoffs to print (default: 5)
  --head       Print only the newest usable path
               (skips empty/unreadable files; same pick as handoff peek)
  --markdown   Agent relay: [bucketRelativePath](fileUri) title lines
               (lists logs/**; nested e.g. feature/name.md; not with --head)`,
  },
  {
    id: "plan",
    group: "Write",
    summary: "Write/update a named plan under vault plans/",
    listUsage: "plan <text>",
    usage: "grounder plan <text> (--title <name> [--force] | --path <file>) [--topics <list>]",
    flags: `Flags:
  --title <name>  Required filename stem when creating/updating by name
                  (trailing .md ok; sanitized, max 80 chars)
  --path <file>   Update an existing plan by path (must resolve under this
                  project's plans/; no title sanitization; always overwrites)
  --force         With --title: overwrite an existing plan (preserves created)
  --topics <list> Comma-separated keywords for search (e.g. "caching,redis,api").
                  On update, omit to keep existing topics.

Subcommands:
  plan list   Print recent plans under plans/** (bucket-relative titles, newest first)`,
  },
  {
    id: "plan list",
    group: "Write",
    summary: "Print recent plans under plans/** (bucket-relative titles, newest first)",
    listUsage: "plan list",
    usage: "grounder plan list [--limit <n>] [--markdown]",
    flags: `Flags:
  --limit <n>  Max plans to print (default: 5)
  --markdown   Agent relay: [bucketRelativePath](fileUri) title lines
               (lists plans/**; nested e.g. migration/cutover.md)`,
  },
  {
    id: "search",
    group: "Retrieve",
    summary: "Search linked project vault for keywords (scoped retrieval)",
    listUsage: "search <query>",
    usage:
      "grounder search <query> [--terms <csv>] [--limit <n>] [--max-hits <n>] [--context <n>] [--since <date>] [--markdown] [--json]",
    flags: `Flags:
  --terms <csv>   Extra keyword variants (comma-separated)
  --limit <n>     Max files to print (default: 10)
  --max-hits <n>  Max stored line snippets per file during scan (default: 50)
  --context <n>   Context lines around each snippet (default: 1)
  --since <date>  Only files modified on or after date (YYYY-MM-DD local midnight, or Nd, e.g. 7d)
  --after <date>  Alias for --since
  --markdown      Agent relay: file:// links + fenced snippets
  --json          Structured output (relativePath, fileUri, alsoMatchedHint per hit)`,
  },
  {
    id: "overview",
    group: "Retrieve",
    summary: "Bird's-eye view: counts + recent titles across notes/handoffs/plans",
    listUsage: "overview",
    usage: "grounder overview [--limit <n>] [--markdown] [--json]",
    flags: `Flags:
  --limit <n>  Max recent titles to print per bucket (default: 3)
  --markdown   Agent relay: [bucketRelativePath](fileUri) title lines
  --json       Structured output (total, count, truncated, items per bucket)`,
  },
  {
    id: "path notes",
    group: "Paths",
    summary: "Print resolved notes directory",
    listUsage: "path notes",
    usage: "grounder path notes",
  },
  {
    id: "path logs",
    group: "Paths",
    summary: "Print resolved logs directory",
    listUsage: "path logs",
    usage: "grounder path logs",
  },
  {
    id: "path plans",
    group: "Paths",
    summary: "Print resolved plans directory",
    listUsage: "path plans",
    usage: "grounder path plans",
  },
  {
    id: "path",
    group: "Paths",
    summary: "Print a resolved vault directory for the linked project",
    listUsage: "path <notes|logs|plans>",
    usage: "grounder path <notes|logs|plans>",
    list: false,
    flags: `Subcommands:
  path notes   Print resolved notes directory
  path logs    Print resolved logs directory
  path plans   Print resolved plans directory`,
  },
  {
    id: "status",
    group: "Maintain",
    summary: "Snapshot of machine + project link + resolved paths",
    listUsage: "status",
    usage: "grounder status [--json]",
    flags: `Flags:
  --json  Print a single-line JSON payload instead of formatted text`,
  },
  {
    id: "doctor",
    group: "Maintain",
    summary: "Health checks with fix hints",
    listUsage: "doctor",
    usage: "grounder doctor [--global]",
    flags: `Flags:
  --global  Machine-only checks (skip project/link checks)`,
  },
  {
    id: "migrate",
    group: "Maintain",
    summary: "Refresh agent install after upgrading grounder",
    listUsage: "migrate",
    usage: "grounder migrate [--force] [--dry-run] [--agent <id>] [--hooks | --no-hooks]",
    flags: `Flags:
  --force      Overwrite skill files you edited locally; also needed
               once when upgrading from Grounder before 0.3. Also
               deletes locally-edited pre-skill grounder-*.md command
               files left over from before 0.6 (edits are not ported)
  --dry-run    Preview without writing
  --agent <id> Limit to a specific agent (repeatable)
  --hooks      Also install hooks if not previously installed
  --no-hooks   Turn hooks off and remove the installed hook entry
               (sticky — a later plain migrate will not re-enable it)

Also retires pre-skill grounder-*.md command files superseded by
SKILL.md packaging (safe ones automatically; edited ones need --force).`,
  },
  {
    id: "handoff peek",
    group: "Advanced",
    summary: "One-line latest-handoff teaser (used by session hooks)",
    listUsage: "handoff peek",
    usage: "grounder handoff peek [--json]",
    flags: `Flags:
  --json  Emit one JSON line for Cursor sessionStart
          ({ additional_context } or {})`,
  },
  {
    id: "help",
    group: "Maintain",
    summary: "Show help (full reference / per-command)",
    listUsage: "help [<command>]",
    usage: "grounder help [<command>]",
    list: false,
    flags: `With no args, prints the full reference (same as --help).
With a command id, prints that command's usage and flags.

Examples:
  grounder help
  grounder help note
  grounder help handoff list
  grounder help setup`,
  },
];

/**
 * Command ids the CLI dispatches (including parent topics). Keep in sync with
 * `cli.ts` / `helpExitCode(...)` call sites — the invariant test locks this.
 */
export const DISPATCHED_COMMAND_IDS = [
  "setup",
  "link",
  "note",
  "note list",
  "handoff",
  "handoff list",
  "handoff peek",
  "plan",
  "plan list",
  "search",
  "overview",
  "path",
  "path notes",
  "path logs",
  "path plans",
  "status",
  "doctor",
  "migrate",
  "help",
] as const;

const byId = new Map(COMMANDS.map((c) => [c.id, c]));

/** True when argv contains an exact `-h` or `--help` token. */
export function wantsHelp(argv: string[]): boolean {
  return argv.some((arg) => arg === "-h" || arg === "--help");
}

/**
 * Resolve a help topic from argv segments after `help`, longest match first
 * (e.g. `handoff list` before `handoff`).
 */
export function resolveCommandHelp(segments: string[]): CommandMeta | undefined {
  if (segments.length === 0) {
    return undefined;
  }
  for (let len = segments.length; len >= 1; len--) {
    const id = segments.slice(0, len).join(" ");
    const meta = byId.get(id);
    if (meta) {
      return meta;
    }
  }
  return undefined;
}

export function printCommandHelp(meta: CommandMeta): void {
  let out = `Usage: ${meta.usage}\n`;
  if (meta.summary) {
    out += `\n${meta.summary}\n`;
  }
  if (meta.flags) {
    out += `\n${meta.flags}\n`;
  }
  process.stdout.write(out);
}

export function printCommandHelpById(id: string): void {
  const meta = byId.get(id);
  if (!meta) {
    throw new Error(`Unknown help id: ${id}`);
  }
  printCommandHelp(meta);
}

/** If argv asks for help, print per-command help and return 0; else null. */
export function helpExitCode(argv: string[], commandId: string): number | null {
  if (!wantsHelp(argv)) {
    return null;
  }
  printCommandHelpById(commandId);
  return 0;
}

function listedCommands(): CommandMeta[] {
  return COMMANDS.filter((c) => c.list !== false);
}

function formatGroupedLists(): string {
  const listed = listedCommands();
  const width = Math.max(...listed.map((c) => c.listUsage.length));
  const blocks: string[] = [];

  for (const group of GROUP_ORDER) {
    const cmds = listed.filter((c) => c.group === group);
    if (cmds.length === 0) {
      continue;
    }
    const lines = cmds.map((c) => `  ${c.listUsage.padEnd(width)}  ${c.summary}`);
    blocks.push(`${group}:\n${lines.join("\n")}`);
  }

  return blocks.join("\n\n");
}

function formatCommandDetail(c: CommandMeta): string {
  const lines = [`${c.id}`, `  Usage: ${c.usage}`];
  if (c.flags) {
    for (const line of c.flags.split("\n")) {
      lines.push(line.length > 0 ? `  ${line}` : "");
    }
  }
  return lines.join("\n");
}

function formatFullCommandDetails(): string {
  const listed = listedCommands().filter((c) => c.id !== "help");
  const blocks: string[] = [];

  for (const group of GROUP_ORDER) {
    const cmds = listed.filter((c) => c.group === group);
    if (cmds.length === 0) {
      continue;
    }
    blocks.push(`${group}\n${cmds.map(formatCommandDetail).join("\n\n")}`);
  }

  return blocks.join("\n\n");
}

const BANNER = "grounder — markdown-native memory for AI agents";

/** Bare `grounder` / `-h` — short grouped synopsis (no flag encyclopedia). */
export function printSynopsis(): void {
  process.stdout.write(`${BANNER}

${formatGroupedLists()}

Global options:
  -h             Short synopsis (this text)
  --help         Full reference (all commands + flags)
  -v, --version  Show version

Run \`grounder help <command>\` for one command's flags.
Run \`grounder --help\` for the full reference.

${QUICKSTART}
`);
}

/** `--help` / `grounder help` with no args — one-shot reference for humans/agents. */
export function printFullHelp(): void {
  process.stdout.write(`${BANNER}

${formatGroupedLists()}

Global options:
  -h             Short synopsis
  --help         This full reference
  -v, --version  Show version

Commands:
${formatFullCommandDetails()}

${QUICKSTART}
`);
}

/** `grounder help [topic…]` — full help or per-command. */
export function runHelp(argv: string[]): number {
  if (argv.length === 0 || wantsHelp(argv)) {
    printFullHelp();
    return 0;
  }

  const meta = resolveCommandHelp(argv);
  if (!meta) {
    process.stderr.write(`Unknown help topic: ${argv.join(" ")}\n`);
    process.stderr.write("Run `grounder --help` for a list of commands.\n");
    return 1;
  }

  printCommandHelp(meta);
  return 0;
}
