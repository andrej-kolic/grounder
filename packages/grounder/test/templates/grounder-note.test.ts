import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../templates/agents",
);

const cursorNoteTemplate = path.join(templatesRoot, "cursor/skills/grounder-note/SKILL.md");
const claudeNoteTemplate = path.join(templatesRoot, "claude/skills/grounder-note/SKILL.md");
const noteTemplates = [cursorNoteTemplate, claudeNoteTemplate] as const;

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n\n/, "");
}

describe("templates/grounder-note", () => {
  it("has the intersection skill frontmatter", async () => {
    for (const filePath of noteTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain("name: grounder-note");
      expect(body).toContain("disable-model-invocation: true");
      expect(body).toMatch(/^description: .+$/m);
    }
  });

  it("documents list-and-stop before write flow", async () => {
    for (const filePath of noteTemplates) {
      const raw = await readFile(filePath, "utf8");
      const body = stripFrontmatter(raw);
      expect(body).toContain("note list --limit <N> --markdown");
      expect(body).toContain("Relay the CLI stdout as-is");
      expect(body).toContain("count header");
      expect(body).toContain("[relativePath](fileUri)");
      expect(body).toContain("newest-first");
      expect(body).toContain("stop — no note write");
      expect(body).toContain('{{GROUNDER_CLI}} note "<body>"');
      expect(body).toContain("--title <slug>");
      expect(body).not.toContain("--path");
      expect(body.startsWith("Save a note to the markdown vault for this project.")).toBe(true);
      expect(body).not.toContain("Obsidian vault");
    }
  });

  it("Cursor note requires unrestricted shell permissions", async () => {
    const body = await readFile(cursorNoteTemplate, "utf8");
    expect(body).toContain('required_permissions: ["all"]');
  });
});
