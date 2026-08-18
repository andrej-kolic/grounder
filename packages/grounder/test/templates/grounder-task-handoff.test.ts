import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../templates/agents",
);

const cursorHandoffTemplate = path.join(templatesRoot, "cursor/commands/grounder-task-handoff.md");
const claudeHandoffTemplate = path.join(templatesRoot, "claude/commands/grounder-task-handoff.md");
const handoffTemplates = [cursorHandoffTemplate, claudeHandoffTemplate] as const;

describe("templates/grounder-task-handoff", () => {
  it("opens with a markdown-vault write, not an Obsidian vault", async () => {
    for (const filePath of handoffTemplates) {
      const body = await readFile(filePath, "utf8");
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
