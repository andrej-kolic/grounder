import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../templates/agents",
);

const cursorHandoffTemplate = path.join(templatesRoot, "cursor/skills/grounder-handoff/SKILL.md");
const claudeHandoffTemplate = path.join(templatesRoot, "claude/skills/grounder-handoff/SKILL.md");
const handoffTemplates = [cursorHandoffTemplate, claudeHandoffTemplate] as const;

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n\n/, "");
}

describe("templates/grounder-handoff", () => {
  it("has the intersection skill frontmatter", async () => {
    for (const filePath of handoffTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain("name: grounder-handoff");
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

  it("mode-locks to write only, ignoring stray resume/hydrate wording", async () => {
    for (const filePath of handoffTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain("Mode lock — write only");
      expect(body).toContain("Never hydrate or start work");
      expect(body).toContain("always write a **new** file");
      expect(body).toContain(
        "ignore any sibling verb that shows up only in a leftover command-payload wrapper",
      );
      expect(body).toContain("saved — run `/grounder-recall` in a new chat to resume");
    }
  });

  it("instructs linking the driving plan/ticket in Files", async () => {
    for (const filePath of handoffTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain(
        "If a vault plan (`grounder plan`) or ticket drove the session, list it first in `## Files`",
      );
      expect(body).toContain("path/to/plan.md (Status section updated)");
    }
  });
});
