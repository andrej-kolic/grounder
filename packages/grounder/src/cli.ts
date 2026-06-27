#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runInit } from "./commands/init.js";
import { runNote } from "./commands/note.js";
import { runPathNotes } from "./commands/path.js";
import { runVaultInit } from "./commands/vault-init.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
  readFileSync(path.join(pkgRoot, "package.json"), "utf8"),
) as { version: string };

const USAGE = `grounder — connect git projects to Obsidian dev vaults for AI agents

Usage:
  grounder vault init <path>   Initialize vault + home config (once per machine)
  grounder init                Connect the current repo to your vault
  grounder note <text>         Write a note to the vault
  grounder path notes          Print resolved notes directory

Options:
  -h, --help     Show this help
  -v, --version  Show version

Init flags:
  --yes          Skip confirmation prompts
  --force        Overwrite existing generated files
  --id <id>      Override detected project id (grounder init)
  --vault <path> Override home vault root for this run (grounder init)

Note flags:
  --title <slug> Note filename slug (default: slugified text)

Quickstart:
  grounder vault init ~/Documents/obsidian/dev
  grounder init
  grounder note "my first note"
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

  if (command === "vault" && rest[0] === "init") {
    process.exit(await runVaultInit(rest.slice(1)));
  }

  if (command === "init") {
    process.exit(await runInit(rest));
  }

  if (command === "note") {
    process.exit(await runNote(rest));
  }

  if (command === "path" && rest[0] === "notes") {
    process.exit(await runPathNotes(rest.slice(1)));
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
