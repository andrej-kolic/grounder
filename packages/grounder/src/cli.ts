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
import { printCommandHelpById, printFullHelp, printSynopsis, runHelp, wantsHelp } from "./help.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8")) as {
  version: string;
};

function printVersion(): void {
  process.stdout.write(`${pkg.version}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "-h") {
    printSynopsis();
    process.exit(0);
  }

  if (args[0] === "--help") {
    printFullHelp();
    process.exit(0);
  }

  if (args[0] === "-v" || args[0] === "--version") {
    printVersion();
    return;
  }

  const [command, ...rest] = args;

  if (command === "help") {
    process.exit(runHelp(rest));
  }

  // Skip banner when it would be noise: help, session hooks, or ledger refresh.
  const skipUpgradeBanner =
    wantsHelp(args) ||
    (command === "handoff" && rest[0] === "peek") ||
    command === "migrate" ||
    (command === "vault" && rest[0] === "init");
  if (!skipUpgradeBanner) {
    await notifyUpgradeIfNeeded();
  }

  if (command === "vault") {
    if (rest[0] === "init") {
      process.exit(await runVaultInit(rest.slice(1)));
    }
    if (wantsHelp(rest)) {
      printCommandHelpById("vault init");
      process.exit(0);
    }
    process.stderr.write(`Unknown command: ${args.join(" ")}\n`);
    process.stderr.write("Run `grounder --help` for a list of commands.\n");
    process.exit(1);
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

  if (command === "path") {
    if (rest[0] === "notes") {
      process.exit(await runPathNotes(rest.slice(1)));
    }
    if (rest[0] === "logs") {
      process.exit(await runPathLogs(rest.slice(1)));
    }
    if (rest[0] === "plans") {
      process.exit(await runPathPlans(rest.slice(1)));
    }
    if (wantsHelp(rest)) {
      printCommandHelpById("path");
      process.exit(0);
    }
    process.stderr.write(`Unknown command: ${args.join(" ")}\n`);
    process.stderr.write("Run `grounder --help` for a list of commands.\n");
    process.exit(1);
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

  process.stderr.write(`Unknown command: ${args.join(" ")}\n`);
  process.stderr.write("Run `grounder --help` for a list of commands.\n");
  process.exit(1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
