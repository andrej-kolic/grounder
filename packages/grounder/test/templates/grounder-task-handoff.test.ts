import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../templates/agents",
);

const cursorHandoffTemplate = path.join(
  templatesRoot,
  "cursor/skills/grounder-task-handoff/SKILL.md",
);
const claudeHandoffTemplate = path.join(
  templatesRoot,
  "claude/skills/grounder-task-handoff/SKILL.md",
);
const handoffTemplates = [cursorHandoffTemplate, claudeHandoffTemplate] as const;

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n\n/, "");
}

describe("templates/grounder-task-handoff", () => {
  it("has the intersection skill frontmatter", async () => {
    for (const filePath of handoffTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain("name: grounder-task-handoff");
      expect(body).toContain("disable-model-invocation: true");
      expect(body).toMatch(/^description: .+$/m);
    }
  });

  it("opens with a markdown-vault write, not an Obsidian vault", async () => {
    for (const filePath of handoffTemplates) {
      const raw = await readFile(filePath, "utf8");
      const body = stripFrontmatter(raw);
      expect(
        body.startsWith(
          "Write a session handoff checkpoint to the markdown vault for this project.",
        ),
      ).toBe(true);
      expect(body).not.toContain("Obsidian vault");
    }
  });

  it("Cursor handoff requires unrestricted shell permissions", async () => {
    const body = await readFile(cursorHandoffTemplate, "utf8");
    expect(body).toContain('required_permissions: ["all"]');
  });
});
