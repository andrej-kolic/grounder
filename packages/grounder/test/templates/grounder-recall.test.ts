import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../templates/agents",
);

const cursorRecallTemplate = path.join(templatesRoot, "cursor/skills/grounder-recall/SKILL.md");
const claudeRecallTemplate = path.join(templatesRoot, "claude/skills/grounder-recall/SKILL.md");
const recallTemplates = [cursorRecallTemplate, claudeRecallTemplate] as const;

describe("templates/grounder-recall", () => {
  it("has the intersection skill frontmatter", async () => {
    for (const filePath of recallTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain("name: grounder-recall");
      expect(body).toContain("disable-model-invocation: true");
      expect(body).toMatch(/^description: .+$/m);
    }
  });

  it("documents the list-and-stop special case and named-session lookup wording", async () => {
    for (const filePath of recallTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain("handoff list --limit <N> --markdown");
      expect(body).toContain("never resort or relabel it");
      expect(body).toContain("stop — no recall");
      expect(body).toContain("Relay the CLI stdout as-is");
      expect(body).toContain("handoff list --limit 5 --markdown");
      expect(body).toContain(
        "indented absolute path in *this* listing (positional, not a stable id)",
      );
      expect(body).toContain("once with `--limit 50 --markdown` (*that* listing only)");
      expect(body).toContain("no guessed recall");
    }
  });

  it("Cursor recall requires unrestricted shell permissions", async () => {
    const body = await readFile(cursorRecallTemplate, "utf8");
    expect(body).toContain('required_permissions: ["all"]');
  });
});
