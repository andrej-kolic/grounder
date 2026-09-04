/**
 * The whole-file install layout Cursor and Claude Code share: Grounder's
 * skills live at `~/<agentDir>/skills/<skill>/SKILL.md`, and the
 * pre-Agent-Skills command files they replaced lived at
 * `~/<agentDir>/commands/<skill>.md`. Give {@link homeSkillsLayout} the two
 * names that differ between the two agents and it derives every path, template
 * render, tombstone, and owned prefix an adapter needs for those artifacts.
 *
 * Hook config is deliberately not here. `~/.cursor/hooks.json` and
 * `~/.claude/settings.json` differ in filename, in JSON shape (a flat array
 * vs. matcher groups), and in what "already converged" even means, so each
 * adapter keeps its own fragment reconciler; `hook-fragment.ts` and
 * `hook-install.ts` hold the parts of *that* job which genuinely are shared.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHomeDir } from "../connector/home.js";
import { fileExists } from "../util/fs.js";
import { runtimeInvocation } from "./hook-runtime.js";

/** Package root (`packages/grounder`) when running from `dist/agents/`. */
const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Skill directory names. Both adapters ship the same set. */
const SKILL_NAMES = [
  "grounder-note",
  "grounder-search",
  "grounder-plan",
  "grounder-task-handoff",
  "grounder-task",
] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

/** Relative `<skill>/SKILL.md` paths, resolved under whichever agent's skills dir. */
const SKILL_FILES = SKILL_NAMES.map((name) => path.join(name, "SKILL.md"));

/**
 * Frozen historical fact about the schema-3 (pre-skill) install layout —
 * deliberately spelled out rather than derived from {@link SKILL_NAMES}, which
 * describes today's Agent Skills layout. Deriving it would rewrite history the
 * moment a skill is added or renamed, retiring paths that never existed while
 * forgetting one that does. Safe to delete once schema-3 installs are assumed
 * extinct in the wild — a maintainer call, not something to automate via a
 * version check.
 */
const LEGACY_COMMAND_FILENAMES = [
  "grounder-note.md",
  "grounder-search.md",
  "grounder-plan.md",
  "grounder-task-handoff.md",
  "grounder-task.md",
] as const;

export interface HomeSkillsLayout {
  /** `~/<agentDir>/skills` — where today's `SKILL.md` files live. */
  skillsDir(homeDir?: string): string;
  /** `~/<agentDir>/commands` — where the retired pre-skill command files lived. */
  legacyCommandsDir(homeDir?: string): string;
  /** Absolute path to one skill's `SKILL.md`. */
  skillPath(skill: SkillName, homeDir?: string): string;
  /** @see AgentAdapter.expectedArtifacts */
  expectedArtifacts(homeDir?: string): string[];
  /** @see AgentAdapter.desiredArtifacts */
  desiredArtifacts(homeDir?: string): Promise<Record<string, string>>;
  /** @see AgentAdapter.tombstones */
  tombstones(homeDir?: string): string[];
  /** @see AgentAdapter.ownedPrefixes */
  ownedPrefixes(homeDir?: string): string[];
  /** @see AgentAdapter.isInstalled */
  isInstalled(): Promise<boolean>;
}

export interface HomeSkillsLayoutOptions {
  /** Adapter id — names the template directory (`templates/agents/<id>/skills`). */
  id: string;
  /** This agent's config directory, relative to home (e.g. `.cursor`). */
  agentDir: string;
}

export function homeSkillsLayout(options: HomeSkillsLayoutOptions): HomeSkillsLayout {
  const templateDir = path.join(pkgRoot, "templates", "agents", options.id, "skills");
  const agentRoot = (homeDir?: string): string =>
    path.join(resolveHomeDir(homeDir), options.agentDir);
  const skillsDir = (homeDir?: string): string => path.join(agentRoot(homeDir), "skills");
  const legacyCommandsDir = (homeDir?: string): string => path.join(agentRoot(homeDir), "commands");

  return {
    skillsDir,
    legacyCommandsDir,

    skillPath: (skill, homeDir) => path.join(skillsDir(homeDir), skill, "SKILL.md"),

    expectedArtifacts: (homeDir) =>
      SKILL_FILES.map((filename) => path.join(skillsDir(homeDir), filename)),

    async desiredArtifacts(homeDir) {
      const cli = runtimeInvocation(homeDir);
      const dir = skillsDir(homeDir);
      const desired: Record<string, string> = {};
      for (const filename of SKILL_FILES) {
        const template = await readFile(path.join(templateDir, filename), "utf8");
        desired[path.join(dir, filename)] = template.replaceAll("{{GROUNDER_CLI}}", cli);
      }
      return desired;
    },

    tombstones: (homeDir) =>
      LEGACY_COMMAND_FILENAMES.map((filename) => path.join(legacyCommandsDir(homeDir), filename)),

    ownedPrefixes: (homeDir) => [skillsDir(homeDir), legacyCommandsDir(homeDir)],

    // No `homeDir` argument on purpose: detection runs before any per-call
    // home override exists, off `GROUNDER_HOME` / `withHomeDir` alone.
    isInstalled: async () => fileExists(agentRoot()),
  };
}
