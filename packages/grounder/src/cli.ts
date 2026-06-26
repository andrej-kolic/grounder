#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
  readFileSync(path.join(pkgRoot, "package.json"), "utf8"),
) as { version: string };

const USAGE = `grounder — connect git projects to Obsidian dev vaults for AI agents

Usage:
  grounder vault init <path>   Initialize a dev vault (once per machine)
  grounder init                Connect the current repo to your vault
  grounder status              Show connection status for this repo
  grounder doctor              Check vault, MCP, and Cursor setup

Options:
  -h, --help     Show this help
  -v, --version  Show version

Run \`npx grounder init\` from any git project root after vault init.
`;

function printHelp(): void {
  process.stdout.write(USAGE);
}

function printVersion(): void {
  process.stdout.write(`${pkg.version}\n`);
}

function main(): void {
  const [, , command, ...rest] = process.argv;

  if (command === "-h" || command === "--help" || command === undefined) {
    printHelp();
    process.exit(command === undefined ? 0 : 0);
  }

  if (command === "-v" || command === "--version") {
    printVersion();
    return;
  }

  if (command === "vault" && rest[0] === "init") {
    process.stderr.write("grounder vault init: not implemented yet\n");
    process.exit(1);
  }

  if (command === "init") {
    process.stderr.write("grounder init: not implemented yet\n");
    process.exit(1);
  }

  if (command === "status") {
    process.stderr.write("grounder status: not implemented yet\n");
    process.exit(1);
  }

  if (command === "doctor") {
    process.stderr.write("grounder doctor: not implemented yet\n");
    process.exit(1);
  }

  process.stderr.write(`Unknown command: ${command}\n\n`);
  printHelp();
  process.exit(1);
}

main();
