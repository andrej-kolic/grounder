#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDoctor } from "./commands/doctor.js";
import { runHandoffList } from "./commands/handoff/list.js";
import { runHandoffPeek } from "./commands/handoff/peek.js";
import { runHandoff } from "./commands/handoff.js";
import { runMigrate } from "./commands/migrate.js";
import { runNote } from "./commands/note.js";
import { runPathLogs } from "./commands/path/logs.js";
import { runPathNotes } from "./commands/path/notes.js";
import { runPathPlans } from "./commands/path/plans.js";
import { runPlan } from "./commands/plan.js";
import { runRepoInit } from "./commands/repo/init.js";
import { runStatus } from "./commands/status.js";
import { notifyUpgradeIfNeeded } from "./commands/upgrade-banner.js";
import { runVaultInit } from "./commands/vault/init.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8")) as {
  version: string;
};

const USAGE = `grounder — connect git projects to Obsidian dev vaults for AI agents

Usage:
  grounder vault init <path>   Initialize vault + home config (once per machine)
  grounder init                Connect the current repo to your vault
  grounder note <text>         Write a note to the vault
  grounder handoff <text>      Write a session handoff to vault logs/
  grounder handoff list        Print recent handoff paths (newest first)
  grounder handoff list --head Print only the newest usable handoff path
  grounder plan <text>         Write/update a named plan under vault plans/
  grounder path notes          Print resolved notes directory
  grounder path logs           Print resolved logs directory
  grounder path plans          Print resolved plans directory
  grounder status              Snapshot of machine + project link + resolved paths
  grounder doctor              Health checks with fix hints
  grounder migrate             Refresh agent install after upgrading grounder

Hook plumbing:
  grounder handoff peek        One-line latest-handoff teaser (used by session hooks)

Options:
  -h, --help     Show this help
  -v, --version  Show version

Init flags:
  --yes          Skip confirmation prompts
  --force        Overwrite existing generated files
  --id <id>      Override detected project id (grounder init)
  --vault <path> Override home vault root for this run (grounder init)
  --agent <id>   Install for a specific agent (repeatable; default: auto-detect)
                 Supported: cursor, claude
  --hooks        Also install session-start teaser hooks (vault init / migrate)

Migrate flags:
  --force        Overwrite command files you edited locally; also needed
                 once when upgrading from Grounder before 0.3
  --dry-run      Preview without writing
  --agent <id>   Limit to a specific agent (repeatable)
  --hooks        Also install hooks if not previously installed

Doctor flags:
  --global       Machine-only checks (skip project/link checks)

Note / handoff flags:
  --title <slug> Short slug in filename (default: slugified first line)
  --limit <n>    Max paths for handoff list (default: 5)
  --head         With handoff list, print only the newest usable path
                 (skips empty/unreadable files; same pick as handoff peek)

Plan flags:
  --title <name> Required filename (trailing .md ok; sanitized, max 80 chars)
  --force        Overwrite an existing plan (preserves original created)

Quickstart:
  grounder vault init <path-to-your-vault>
  grounder init
  grounder note "my first note"
  grounder handoff "# Handoff\\n\\n## Next\\n1. …"
  grounder handoff list
  grounder plan "# Goal\\n\\nShip it" --title phase-1
`;

function printHelp(): void {
  process.stdout.write(USAGE);
}

function printVersion(): void {
  process.stdout.write(`${pkg.version}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    printHelp();
    process.exit(0);
  }

  if (args[0] === "-v" || args[0] === "--version") {
    printVersion();
    return;
  }

  const [command, ...rest] = args;

  // Skip banner when it would be noise: session hooks, or commands that refresh the ledger.
  const skipUpgradeBanner =
    (command === "handoff" && rest[0] === "peek") ||
    command === "migrate" ||
    (command === "vault" && rest[0] === "init");
  if (!skipUpgradeBanner) {
    await notifyUpgradeIfNeeded();
  }

  if (command === "vault" && rest[0] === "init") {
    process.exit(await runVaultInit(rest.slice(1)));
  }

  if (command === "init") {
    process.exit(await runRepoInit(rest));
  }

  if (command === "note") {
    process.exit(await runNote(rest));
  }

  if (command === "handoff" && rest[0] === "list") {
    process.exit(await runHandoffList(rest.slice(1)));
  }

  if (command === "handoff" && rest[0] === "peek") {
    process.exit(await runHandoffPeek(rest.slice(1)));
  }

  if (command === "handoff") {
    process.exit(await runHandoff(rest));
  }

  if (command === "plan") {
    process.exit(await runPlan(rest));
  }

  if (command === "path" && rest[0] === "notes") {
    process.exit(await runPathNotes(rest.slice(1)));
  }

  if (command === "path" && rest[0] === "logs") {
    process.exit(await runPathLogs(rest.slice(1)));
  }

  if (command === "path" && rest[0] === "plans") {
    process.exit(await runPathPlans(rest.slice(1)));
  }

  if (command === "status") {
    process.exit(await runStatus(rest));
  }

  if (command === "doctor") {
    process.exit(await runDoctor(rest));
  }

  if (command === "migrate") {
    process.exit(await runMigrate(rest));
  }

  process.stderr.write(`Unknown command: ${args.join(" ")}\n\n`);
  printHelp();
  process.exit(1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
