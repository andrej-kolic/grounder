import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../templates/agents",
);

const planTemplates = [
  path.join(templatesRoot, "cursor/commands/grounder-plan.md"),
  path.join(templatesRoot, "claude/commands/grounder-plan.md"),
] as const;

describe("templates/grounder-plan", () => {
  it("documents path update, plan list lookup, and title-only create", async () => {
    for (const filePath of planTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain("always state it plainly before writing");
      expect(body).toContain("printed by an earlier `grounder plan` this conversation");
      expect(body).toContain("plan list --limit 5");
      expect(body).toContain("never guess");
      expect(body).toContain("genuinely new plan");
      expect(body).toContain("--path <path>");
      expect(body).toContain("--title <name>");
      expect(body).toContain("**never** use it to update a plan you meant to target with `--path`");
    }
  });

  it("Cursor plan requires unrestricted shell permissions", async () => {
    const body = await readFile(planTemplates[0], "utf8");
    expect(body).toContain('required_permissions: ["all"]');
  });
});
