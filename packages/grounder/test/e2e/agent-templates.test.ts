import { spawnSync } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DISPATCHED_COMMAND_IDS } from "../../src/help.js";

/**
 * Static lint: every `{{GROUNDER_CLI}} <subcommand>` invocation documented in
 * the skill templates must map to a real, currently-registered
 * grounder subcommand, and every `--flag` mentioned near it must be a flag
 * that subcommand's own `--help` documents. Catches a renamed/removed CLI
 * command or flag silently breaking a template — no live agent or LLM
 * involved, just the built CLI's own `--help` output as the source of truth.
 */

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(pkgRoot, "dist", "cli.js");
const templatesRoot = path.join(pkgRoot, "templates", "agents");

function runCli(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

/** Every `SKILL.md` under each host's `templates/agents/<host>/skills/` — agent dirs without one are skipped, not an error. */
async function findTemplateFiles(): Promise<string[]> {
  const agentDirs = await readdir(templatesRoot, { withFileTypes: true });
  const files: string[] = [];
  for (const agentDir of agentDirs) {
    if (!agentDir.isDirectory()) continue;
    const skillsDir = path.join(templatesRoot, agentDir.name, "skills");
    let skillEntries: Dirent[];
    try {
      skillEntries = await readdir(skillsDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of skillEntries) {
      if (!entry.isDirectory()) continue;
      files.push(path.join(skillsDir, entry.name, "SKILL.md"));
    }
  }
  return files;
}

/** `{{GROUNDER_CLI}} note …` / `handoff list …` / `plan …` — a real invocation. */
const INVOCATION = /^\s+(note|handoff|plan|search|overview)(?:\s+([a-z]+))?\b/;
/** `Run {{GROUNDER_CLI}} with \`required_permissions…\`` — generic prose, not an invocation. */
const PROSE_REFERENCE = /^\s+with\s+`/;
/** Long-form flags (`--title`, `--limit`, …) mentioned within a documented invocation's own span. */
const FLAG = /--[a-z][a-z-]*/g;
/** Multi-line heredoc form templates document for `note`/`handoff`/`plan` bodies. */
const HEREDOC_START = /^\s+\S+\s+"\$\(cat <<'EOF'/;
const HEREDOC_END = '\nEOF\n)"';

const DISPATCHED_IDS: readonly string[] = DISPATCHED_COMMAND_IDS;

/**
 * The exact span of one documented invocation within `rest` (text right
 * after a `{{GROUNDER_CLI}}` marker) — bounded tightly so flags mentioned in
 * *surrounding prose* (e.g. a later paragraph explaining `--force`) are never
 * mistaken for flags that invocation actually uses:
 * - Heredoc body (`"$(cat <<'EOF' … EOF )"`) → through the closing `)"` plus
 *   any trailing flags on that same line (`--path <path>`, `--title <name>`).
 * - Otherwise → up to the first newline or inline-code backtick.
 */
function invocationSpan(rest: string): string {
  if (HEREDOC_START.test(rest)) {
    const closeIdx = rest.indexOf(HEREDOC_END);
    if (closeIdx === -1) {
      throw new Error(`heredoc invocation missing expected closing "${HEREDOC_END}"`);
    }
    const afterClose = rest.slice(closeIdx + HEREDOC_END.length);
    const trailingEnd = afterClose.search(/\n|`/);
    const trailing = trailingEnd === -1 ? afterClose : afterClose.slice(0, trailingEnd);
    return rest.slice(0, closeIdx + HEREDOC_END.length) + trailing;
  }
  const end = rest.search(/\n|`/);
  return end === -1 ? rest : rest.slice(0, end);
}

interface Occurrence {
  subcommand: string[];
  /** Flags mentioned between this occurrence and the next `{{GROUNDER_CLI}}` (or EOF). */
  flags: string[];
}

/**
 * Walk every `{{GROUNDER_CLI}}` occurrence in `file` and classify it as a real
 * invocation or the known prose reference. Throws on anything else so a new,
 * unrecognized usage shape fails loudly instead of being silently skipped.
 *
 * A second word is only folded into the subcommand id (e.g. `note list`)
 * when that two-word id is actually dispatched (`DISPATCHED_COMMAND_IDS`) —
 * so a future `handoff peek` invocation in a template is classified as
 * `handoff peek`, not misread as bare `handoff`.
 */
async function collectInvocations(file: string): Promise<Occurrence[]> {
  const text = await readFile(file, "utf8");
  const marker = "{{GROUNDER_CLI}}";
  const occurrences: Occurrence[] = [];
  let from = 0;

  while (true) {
    const idx = text.indexOf(marker, from);
    if (idx === -1) break;
    const restStart = idx + marker.length;
    const rest = text.slice(restStart);
    const invocation = INVOCATION.exec(rest);
    if (invocation) {
      const base = invocation[1];
      const second = invocation[2];
      const twoWord = second ? `${base} ${second}` : undefined;
      const subcommand = twoWord && DISPATCHED_IDS.includes(twoWord) ? [base, second] : [base];
      const flags = [...invocationSpan(rest).matchAll(FLAG)].map((m) => m[0]);

      occurrences.push({ subcommand, flags });
    } else if (!PROSE_REFERENCE.test(rest)) {
      throw new Error(
        `Unrecognized {{GROUNDER_CLI}} usage in ${path.relative(pkgRoot, file)}: …${rest.slice(0, 60).trim()}…`,
      );
    }
    from = restStart;
  }

  return occurrences;
}

describe("e2e/agent-templates", () => {
  it("every {{GROUNDER_CLI}} invocation maps to a real, documented grounder subcommand + flags", async () => {
    const files = await findTemplateFiles();
    expect(files.length).toBeGreaterThan(0);

    const bySubcommand = new Map<string, { file: string; flags: Set<string> }>();
    for (const file of files) {
      const rel = path.relative(pkgRoot, file);
      for (const { subcommand, flags } of await collectInvocations(file)) {
        const id = subcommand.join(" ");
        const entry = bySubcommand.get(id) ?? { file: rel, flags: new Set<string>() };
        for (const flag of flags) entry.flags.add(flag);
        bySubcommand.set(id, entry);
      }
    }

    // Sanity check the extractor itself isn't silently matching nothing.
    expect(bySubcommand.size).toBeGreaterThan(0);
    expect([...bySubcommand.keys()]).toEqual(
      expect.arrayContaining([
        "note",
        "note list",
        "handoff",
        "handoff list",
        "plan",
        "plan list",
        "search",
      ]),
    );

    for (const [subcommand, { file, flags }] of bySubcommand) {
      const result = runCli([...subcommand.split(" "), "--help"]);
      expect(
        result.status,
        `\`grounder ${subcommand}\` (referenced in ${file}) should be a real command`,
      ).toBe(0);
      expect(result.stdout).toContain(`Usage: grounder ${subcommand}`);

      for (const flag of flags) {
        expect(
          result.stdout,
          `\`grounder ${subcommand} --help\` should document ${flag} (referenced near an invocation in ${file})`,
        ).toContain(flag);
      }
    }
  });
});
