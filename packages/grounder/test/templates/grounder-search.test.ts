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
      expect(body).toContain("never a lone generic verb");
      expect(body).toContain("source module / file stems");
      expect(body).toContain("retry queue,dead letter,jobs.json,RetryPolicy,ttl");
      expect(body).toContain("wrong query: `expired job retries`");
      expect(body).not.toContain("commandsSchema");
      expect(body).not.toContain("install-command");
      expect(body).not.toContain("`grounder migrate`");
      expect(body).toContain("leftover top-10 **in CLI order**");
      expect(body).toContain("Unread hits must not grow new facts");
      expect(body).toContain("matches[].term");
      expect(body).toContain("hits[].relativePath");
      expect(body).toContain("hits[].fileUri");
      expect(body).toContain("alsoMatchedHint");
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
      expect(body).toContain("I have searched");
      expect(body).toContain("hits[i].file");
      expect(body).toContain("bare links are invalid");
      expect(body).toContain("`##` headings required");
    }
  });

  it("does not prime this-repo vocabulary as the worked example", async () => {
    for (const filePath of searchTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain("look up why the retry queue must skip expired jobs");
      expect(body).not.toContain("session start hooks");
      expect(body).not.toContain(
        "terms: `slash commands,grounder migrate,hash drift,commandsSchema,state.json`",
      );
    }
  });

  it("Cursor search requires unrestricted shell permissions", async () => {
    const body = await readFile(cursorSearchTemplate, "utf8");
    expect(body).toContain('required_permissions: ["all"]');
  });

  it("documents deterministic broaden strategy and termHitCounts triggers", async () => {
    for (const filePath of searchTemplates) {
      const body = await readFile(filePath, "utf8");
      expect(body).toContain("termHitCounts");
      expect(body).toContain("count of 0");
      expect(body).toContain("--context 3 --json");
      expect(body).toContain("drop slot-3");
      expect(body).toContain("replace **that term**");
      expect(body).toContain("Keep slots 1–2");
    }
  });
});
