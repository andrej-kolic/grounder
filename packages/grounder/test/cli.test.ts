import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTempEnv, withGroundedHome } from "./helpers.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(pkgRoot, "dist", "cli.js");
const { version } = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8")) as {
  version: string;
};

function run(args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: env ?? process.env,
  });
}

describe("grounder cli", () => {
  it("prints version", () => {
    const result = run(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(version);
  });

  it("prints short synopsis for bare invocation and -h", () => {
    for (const args of [[], ["-h"]] as string[][]) {
      const result = run(args);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Setup:");
      expect(result.stdout).toContain("Write:");
      expect(result.stdout).toContain("Maintain:");
      expect(result.stdout).toContain("grounder help <command>");
      // `help` is discoverable via global options / pointer, not the command list.
      expect(result.stdout).not.toMatch(/^\s+help /m);
      expect(result.stdout).not.toContain("\nCommands:\n");
      expect(result.stdout).not.toContain("--dry-run");
      expect(result.stdout).not.toContain("Hook plumbing");
      expect(result.stdout).not.toContain("handoff list --head");
    }
  });

  it("prints full help for --help and help with no args", () => {
    for (const args of [["--help"], ["help"]] as string[][]) {
      const result = run(args);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Setup:");
      expect(result.stdout).toContain("Commands:");
      expect(result.stdout).toContain("Setup\nvault init");
      expect(result.stdout).toContain("Write\nnote");
      expect(result.stdout).toContain("Usage: grounder vault init");
      expect(result.stdout).toContain("Usage: grounder note");
      expect(result.stdout).toContain("Usage: grounder plan");
      expect(result.stdout).toContain("Usage: grounder migrate");
      expect(result.stdout).toContain("handoff peek");
      expect(result.stdout).toContain("--hooks");
      expect(result.stdout).toContain("--dry-run");
      expect(result.stdout).toContain("--global");
      expect(result.stdout).toContain("--title");
      expect(result.stdout).not.toContain("Hook plumbing");
      // Full reference must be more than the synopsis (includes flag bodies).
      const synopsis = run(["-h"]);
      expect(result.stdout.length).toBeGreaterThan(synopsis.stdout.length);
    }
  });

  it("prints the same per-command help for help <cmd> and <cmd> --help", () => {
    const viaHelp = run(["help", "note"]);
    const viaFlag = run(["note", "--help"]);
    const viaShort = run(["note", "-h"]);

    expect(viaHelp.status).toBe(0);
    expect(viaFlag.status).toBe(0);
    expect(viaShort.status).toBe(0);
    expect(viaHelp.stdout).toBe(viaFlag.stdout);
    expect(viaHelp.stdout).toBe(viaShort.stdout);
    expect(viaHelp.stdout).toContain("Usage: grounder note");
    expect(viaHelp.stdout).toContain("--title");
  });

  it("prints nested subcommand help", () => {
    for (const [args, needle] of [
      [["handoff", "list", "--help"], "handoff list"],
      [["help", "handoff", "list"], "handoff list"],
      [["plan", "list", "--help"], "plan list"],
      [["help", "plan", "list"], "plan list"],
      [["note", "list", "--help"], "note list"],
      [["help", "note", "list"], "note list"],
      [["handoff", "peek", "--help"], "handoff peek"],
      [["vault", "init", "--help"], "vault init"],
      [["help", "vault", "init"], "vault init"],
      [["help", "vault"], "vault init"],
      [["vault", "--help"], "vault init"],
      [["path", "notes", "--help"], "path notes"],
      [["help", "path", "notes"], "path notes"],
      [["path", "--help"], "path <notes|logs|plans>"],
      [["help", "path"], "path <notes|logs|plans>"],
    ] as const) {
      const result = run([...args]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`Usage: grounder ${needle}`);
    }
  });

  it("prints parent usage for bare vault/path", () => {
    const vault = run(["vault"]);
    expect(vault.status).toBe(0);
    expect(vault.stdout).toContain("Usage: grounder vault init");
    expect(vault.stdout).toContain("Subcommands:");

    const pathCmd = run(["path"]);
    expect(pathCmd.status).toBe(0);
    expect(pathCmd.stdout).toContain("Usage: grounder path <notes|logs|plans>");
    expect(pathCmd.stdout).toContain("Subcommands:");
  });

  it("prints parent usage (exit 1) for unknown vault/path subcommands", () => {
    const vault = run(["vault", "nope"]);
    expect(vault.status).toBe(1);
    expect(vault.stdout).toContain("Usage: grounder vault init");

    const pathCmd = run(["path", "nope"]);
    expect(pathCmd.status).toBe(1);
    expect(pathCmd.stdout).toContain("Usage: grounder path <notes|logs|plans>");
  });

  it("short-circuits --help before side effects on argument-less commands", async () => {
    const env = await createTempEnv();
    try {
      const grounded = withGroundedHome(env.home);

      const initHelp = run(["init", "--help"], grounded);
      expect(initHelp.status).toBe(0);
      expect(initHelp.stdout).toContain("Usage: grounder init");
      expect(initHelp.stdout).not.toContain("Will create:");
      expect(initHelp.stderr).not.toContain("Proceed?");

      const migrateHelp = run(["migrate", "-h"], grounded);
      expect(migrateHelp.status).toBe(0);
      expect(migrateHelp.stdout).toContain("Usage: grounder migrate");
      expect(migrateHelp.stdout).not.toContain("No home config");

      const vaultHelp = run(["vault", "init", env.vault, "--help"], grounded);
      expect(vaultHelp.status).toBe(0);
      expect(vaultHelp.stdout).toContain("Usage: grounder vault init");
      expect(vaultHelp.stdout).not.toContain("Will write:");

      const doctorHelp = run(["doctor", "--help"], grounded);
      expect(doctorHelp.status).toBe(0);
      expect(doctorHelp.stdout).toContain("Usage: grounder doctor");
      expect(doctorHelp.stdout).not.toContain("home.config");

      const statusHelp = run(["status", "-h"], grounded);
      expect(statusHelp.status).toBe(0);
      expect(statusHelp.stdout).toContain("Usage: grounder status");
      expect(statusHelp.stdout).not.toContain("Machine:");
    } finally {
      await env.cleanup();
    }
  });

  it("prints a short error for unknown commands", () => {
    const result = run(["not-a-command"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown command: not-a-command");
    expect(result.stderr).toContain("Run `grounder --help`");
    expect(result.stderr).not.toContain("Setup:");
    expect(result.stdout).toBe("");
  });

  it("uses ANSI-C quoting in Quickstart examples", () => {
    const result = run(["--help"]);
    expect(result.stdout).toContain("grounder handoff $'# Handoff\\n\\n## Next\\n1. …'");
    expect(result.stdout).toContain("grounder plan $'# Goal\\n\\nShip it' --title phase-1");
  });

  it("requires text for note command", () => {
    const result = run(["note"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: grounder note");
  });

  it("requires text and title for plan command", () => {
    const missingText = run(["plan"]);
    expect(missingText.status).toBe(1);
    expect(missingText.stderr).toContain("Usage: grounder plan <text> --title <name>");

    const missingTitle = run(["plan", "body only"]);
    expect(missingTitle.status).toBe(1);
    expect(missingTitle.stderr).toContain("Usage: grounder plan <text> --title <name>");
  });
});
