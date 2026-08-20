import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const templatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../templates/agents",
);

const cursorSearchTemplate = path.join(templatesRoot, "cursor/commands/grounder-search.md");
const claudeSearchTemplate = path.join(templatesRoot, "claude/commands/grounder-search.md");
const searchTemplates = [cursorSearchTemplate, claudeSearchTemplate] as const;

describe("templates/grounder-search", () => {
  it("documents the term recipe, query stripping, and leftover-hit order", async () => {
    for (const filePath of searchTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain(
        '{{GROUNDER_CLI}} search "<query>" --terms "<csv>" --context 2 --json',
      );
      expect(body).toContain("Strip retrieval wrappers");
      expect(body).toContain("never the lone generic `migrate`");
      expect(body).toContain("install-command");
      expect(body).toContain(
        "slash commands,grounder migrate,hash drift,commandsSchema,state.json",
      );
      expect(body).toContain("leftover top-10 **in CLI order**");
      expect(body).toContain("Unread hits must not grow new facts");
      expect(body).toContain("hits[].matches[].term");
      expect(body).not.toContain("Obsidian vault");
    }
  });

  it("Cursor search requires unrestricted shell permissions", async () => {
    const body = await readFile(cursorSearchTemplate, "utf8");
    expect(body).toContain('required_permissions: ["all"]');
  });
});
