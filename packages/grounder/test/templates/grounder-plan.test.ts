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
      expect(body).toContain("--path <path-to-existing-plan.md>");
      expect(body).toContain("plan list --limit 5");
      expect(body).toContain("never guess a `--title` for an update");
      expect(body).toContain("Genuinely new plan");
      expect(body).toContain("--title <name>");
      expect(body).toContain("silently pass `--force`");
      expect(body).toContain("printed by an earlier `grounder plan` this conversation");
    }
  });
});
