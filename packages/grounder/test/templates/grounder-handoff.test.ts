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
        "The plain write form of `handoff` (a body argument, no `list`) stays required",
      );
      expect(body).toContain(
        "ignore any sibling verb that shows up only in a leftover command-payload wrapper",
      );
      // The redirect sentence is gated on the typed text actually asking for it —
      // a bare invocation must never emit it (regression caught in PR #103 review).
      expect(body).toContain(
        "If the typed text does ask to resume/load/hydrate/`/grounder-recall`, still do this command's job",
      );
      expect(body).toContain("saved — run `/grounder-recall` in a new chat to resume");
    }
  });

  it("still writes a handoff on a fresh/empty session, not a menu of options", async () => {
    for (const filePath of handoffTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain("Nothing done yet is not a reason to skip writing");
      expect(body).toContain("never reply with a menu of options instead of running the write");
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

  it("shows the plan/ticket line in the fenced body agents actually fill in, not just in Rules prose", async () => {
    for (const filePath of handoffTemplates) {
      const body = await readFile(filePath, "utf8");
      const fenceMatch = body.match(/```markdown\n([\s\S]*?)\n```/);
      expect(fenceMatch, "expected a fenced markdown body example").toBeTruthy();
      const fence = fenceMatch?.[1];
      expect(fence).toContain("path/to/plan.md (Status section updated)");
    }
  });

  it("keeps the vault session-handoff reference in sync with the plan/ticket convention", async () => {
    const referencePath = path.join(templatesRoot, "../vault/session-handoff.md");
    const body = await readFile(referencePath, "utf8");
    expect(body).toContain("path/to/plan.md (Status section updated)");
  });
});
