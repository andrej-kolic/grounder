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
      expect(body).toContain("Strip only retrieval wrappers");
      expect(body).toContain("never the lone generic `migrate`");
      expect(body).toContain("install-command");
      expect(body).toContain("apply-agent-installs");
      expect(body).toContain("`slash commands`");
      expect(body).toContain("`grounder migrate`");
      expect(body).toContain("session hooks,fail silent,hooks.json,hooksSchema,SessionStart");
      expect(body).toContain("wrong query: `slash command migrations`");
      expect(body).toContain("leftover top-10 **in CLI order**");
      expect(body).toContain("Unread hits must not grow new facts");
      expect(body).toContain("hits[].matches[].term");
      expect(body).not.toContain("Obsidian vault");
    }
  });

  it("requires silence, a two-round tool allowlist, vault-relative titles, and href-only encoding", async () => {
    for (const filePath of searchTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain("no assistant text");
      expect(body).toContain("no text part in those messages");
      expect(body).toContain("**Analyzing…**");
      expect(body).toContain("UpdateCurrentStep");
      expect(body).toContain("Do not add a third tool turn");
      expect(body).toContain("10-Projects/grounder/plans/");
      expect(body).toContain("plans/archive/0.2.0 and older/doc.md");
      expect(body).toContain("`%20` in the title");
      expect(body).toContain("`##` headings required");
    }
  });

  it("does not prime slash-command migration terms as the worked example", async () => {
    for (const filePath of searchTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain("look up why session start hooks must exit 0");
      expect(body).toContain("wrong query: `slash command migrations`");
      expect(body).not.toContain(
        "terms: `slash commands,grounder migrate,hash drift,commandsSchema,state.json`",
      );
    }
  });

  it("Cursor search requires unrestricted shell permissions", async () => {
    const body = await readFile(cursorSearchTemplate, "utf8");
    expect(body).toContain('required_permissions: ["all"]');
  });
});
