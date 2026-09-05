import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../templates/agents",
);

const SKILLS = [
  "grounder-note",
  "grounder-search",
  "grounder-overview",
  "grounder-plan",
  "grounder-task-handoff",
  "grounder-task",
] as const;

/**
 * Every Cursor/Claude Code line pair a `SKILL.md` is allowed to differ on —
 * the Cursor vs. Claude Code shell-permissions phrasing (commands-to-skills
 * review item 6: both intentional, see the review plan). Any other line
 * difference means one copy drifted from the other without the edit being
 * ported to both.
 */
const KNOWN_DIFFERING_LINES: ReadonlyArray<{ cursor: string; claude: string }> = [
  {
    cursor:
      'Run {{GROUNDER_CLI}} with `required_permissions: ["all"]` (vault is outside the workspace).',
    claude:
      "The vault is outside the workspace — grant shell permissions if Claude Code prompts you.",
  },
  {
    cursor: "   - Request vault read permissions as needed.",
    claude: "   - Grant read permissions for vault paths outside the workspace when needed.",
  },
];

describe("templates/skill-parity", () => {
  for (const skill of SKILLS) {
    it(`${skill}/SKILL.md matches between cursor and claude except the known permissions phrasing`, async () => {
      const cursorPath = path.join(templatesRoot, "cursor/skills", skill, "SKILL.md");
      const claudePath = path.join(templatesRoot, "claude/skills", skill, "SKILL.md");
      const [cursorBody, claudeBody] = await Promise.all([
        readFile(cursorPath, "utf8"),
        readFile(claudePath, "utf8"),
      ]);

      const cursorLines = cursorBody.split("\n");
      const claudeLines = claudeBody.split("\n");
      expect(claudeLines.length).toBe(cursorLines.length);

      for (let i = 0; i < cursorLines.length; i++) {
        const cursorLine = cursorLines[i];
        const claudeLine = claudeLines[i];
        if (cursorLine === claudeLine) {
          continue;
        }
        const isKnownPair = KNOWN_DIFFERING_LINES.some(
          (pair) => pair.cursor === cursorLine && pair.claude === claudeLine,
        );
        expect(
          isKnownPair,
          `line ${i + 1} differs and isn't a known permissions-phrasing pair:\n  cursor: ${cursorLine}\n  claude: ${claudeLine}`,
        ).toBe(true);
      }
    });
  }
});
