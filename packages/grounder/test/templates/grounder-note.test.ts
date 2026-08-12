import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../templates/agents",
);

const cursorNoteTemplate = path.join(templatesRoot, "cursor/commands/grounder-note.md");
const claudeNoteTemplate = path.join(templatesRoot, "claude/commands/grounder-note.md");
const noteTemplates = [cursorNoteTemplate, claudeNoteTemplate] as const;

describe("templates/grounder-note", () => {
  it("documents list-and-stop before write flow", async () => {
    for (const filePath of noteTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain("note list --limit <N>");
      expect(body).toContain("Relay the CLI stdout as-is");
      expect(body).toContain("count header");
      expect(body).toContain("newest-first");
      expect(body).toContain("stop — no note write");
      expect(body).toContain('{{GROUNDER_CLI}} note "<body>"');
      expect(body).toContain("--title <slug>");
      expect(body).not.toContain("--path");
    }
  });

  it("Cursor note requires unrestricted shell permissions", async () => {
    const body = await readFile(cursorNoteTemplate, "utf8");
    expect(body).toContain('required_permissions: ["all"]');
  });
});
