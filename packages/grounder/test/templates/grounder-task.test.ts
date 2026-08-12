import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../templates/agents",
);

const cursorTaskTemplate = path.join(templatesRoot, "cursor/commands/grounder-task.md");
const claudeTaskTemplate = path.join(templatesRoot, "claude/commands/grounder-task.md");
const taskTemplates = [cursorTaskTemplate, claudeTaskTemplate] as const;

describe("templates/grounder-task", () => {
  it("documents the list-and-stop special case and named-session lookup wording", async () => {
    for (const filePath of taskTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain("handoff list --limit <N>");
      expect(body).toContain("never resort or relabel it");
      expect(body).toContain("stop — no hydrate");
      expect(body).toContain("Relay the CLI stdout as-is");
      expect(body).toContain("handoff list --limit 5");
      expect(body).toContain("count header + numbered title/path");
      expect(body).toContain("from *this* listing (positional, not a stable id)");
    }
  });

  it("Cursor task requires unrestricted shell permissions", async () => {
    const body = await readFile(cursorTaskTemplate, "utf8");
    expect(body).toContain('required_permissions: ["all"]');
  });
});
