import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../templates/agents",
);

const cursorPlanTemplate = path.join(templatesRoot, "cursor/skills/grounder-plan/SKILL.md");
const claudePlanTemplate = path.join(templatesRoot, "claude/skills/grounder-plan/SKILL.md");
const planTemplates = [cursorPlanTemplate, claudePlanTemplate] as const;

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n\n/, "");
}

describe("templates/grounder-plan", () => {
  it("has the intersection skill frontmatter", async () => {
    for (const filePath of planTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain("name: grounder-plan");
      expect(body).toContain("disable-model-invocation: true");
      expect(body).toMatch(/^description: .+$/m);
    }
  });

  it("documents path update, plan list lookup, and title-only create", async () => {
    for (const filePath of planTemplates) {
      const raw = await readFile(filePath, "utf8");
      const body = stripFrontmatter(raw);
      expect(body).toContain("state it plainly before writing");
      expect(body).toContain("not a blocking confirmation");
      expect(body).toContain("printed by an earlier `grounder plan` this conversation");
      expect(body).toContain("plan list --limit 5 --markdown");
      expect(body).toContain("Relay the CLI stdout as-is");
      expect(body).toContain("count header");
      expect(body).toContain("[relativePath](fileUri)");
      expect(body).not.toContain("Lead with");
      expect(body).toContain('not just "it\'s the only plan in the project."');
      expect(body).toContain("never guess");
      expect(body).toContain("genuinely new plan");
      expect(body).toContain("--path <path>");
      expect(body).toContain("--title <name>");
      expect(body).toContain("**never** use it to update a plan you meant to target with `--path`");
      expect(
        body.startsWith(
          "Write a named, updatable plan document to the markdown vault for this project.",
        ),
      ).toBe(true);
      expect(body).not.toContain("Obsidian vault");
    }
  });

  it("Cursor plan requires unrestricted shell permissions", async () => {
    const body = await readFile(cursorPlanTemplate, "utf8");
    expect(body).toContain('required_permissions: ["all"]');
  });
});
