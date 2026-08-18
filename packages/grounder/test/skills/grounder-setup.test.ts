import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const skillDir = path.join(repoRoot, "skills/grounder-setup");
const skillPath = path.join(skillDir, "SKILL.md");
const packageJsonPath = path.join(repoRoot, "packages/grounder/package.json");

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function unquoteYamlScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Minimal YAML frontmatter reader for `name` / `description` (plain or `>` / `|` folded). */
function parseSkillFrontmatter(content: string): {
  name?: string;
  description?: string;
  keys: string[];
} {
  const fence = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!fence) {
    return { keys: [] };
  }

  const result: { name?: string; description?: string; keys: string[] } = { keys: [] };
  const lines = fence[1]?.split(/\r?\n/) ?? [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const folded = /^(name|description):\s*([>|]-?)\s*$/.exec(line);
    if (folded) {
      const key = folded[1] as "name" | "description";
      const style = folded[2] ?? ">";
      result.keys.push(key);
      const collected: string[] = [];
      i += 1;
      while (i < lines.length && /^(?: {2}|\t)/.test(lines[i] ?? "")) {
        collected.push((lines[i] ?? "").replace(/^(?: {2}|\t)/, ""));
        i += 1;
      }
      result[key] = style.startsWith(">")
        ? collected.join(" ").replace(/\s+/g, " ").trim()
        : collected.join("\n");
      continue;
    }

    const kv = /^(name|description):\s*(.*?)\s*$/.exec(line);
    if (kv) {
      const key = kv[1] as "name" | "description";
      result.keys.push(key);
      result[key] = unquoteYamlScalar(kv[2] ?? "");
    } else {
      const extra = /^([A-Za-z0-9_-]+):/.exec(line);
      if (extra?.[1]) {
        result.keys.push(extra[1]);
      }
    }
    i += 1;
  }
  return result;
}

describe("skills/grounder-setup", () => {
  it("frontmatter name matches the folder and description is a portable trigger", async () => {
    const content = await readFile(skillPath, "utf8");
    const { name, description, keys } = parseSkillFrontmatter(content);

    expect(name).toBe(path.basename(skillDir));
    expect(name).toMatch(NAME_RE);
    expect(name?.length).toBeGreaterThan(0);
    expect(name?.length).toBeLessThanOrEqual(64);

    expect(description).toBeTruthy();
    expect(description?.length).toBeGreaterThan(0);
    expect(description?.length).toBeLessThanOrEqual(1024);

    expect(keys).not.toContain("disable-model-invocation");
    expect(keys).not.toContain("context");
  });

  it("previews vault init and init via --dry-run instead of listing writes", async () => {
    const content = await readFile(skillPath, "utf8");
    expect(content).toContain("vault init <path> --hooks --dry-run");
    expect(content).toContain("init --dry-run");
    expect(content).not.toContain("`vault init` writes:");
    expect(content).not.toContain("`init` writes:");
  });

  it("asks for a markdown vault path, not an Obsidian vault or notes folder", async () => {
    const content = await readFile(skillPath, "utf8");
    expect(content).toContain(`"What's the path to your markdown vault?"`);
    expect(content).not.toContain("What's the path to your Obsidian vault?");
    expect(content).not.toContain("Obsidian vault");
    expect(content).not.toContain("notes folder");
  });

  it("narrates connect/link/refresh purpose lines verbatim before dry-run", async () => {
    const content = await readFile(skillPath, "utf8");
    expect(content).toContain("say the matching purpose line verbatim");
    expect(content).toContain("**Connect** to a markdown vault (once per machine).");
    expect(content).toContain(
      "**Link this project** inside the markdown vault (once per project).",
    );
    expect(content).toContain("**Refresh Grounder after an upgrade.**");
  });

  it("is not shipped in the npm tarball", async () => {
    const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as { files?: string[] };
    expect(pkg.files).toEqual(["dist", "templates"]);
  });
});
