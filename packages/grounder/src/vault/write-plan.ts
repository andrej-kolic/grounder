import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseHandoffFrontmatter } from "../util/frontmatter.js";
import { fileExists } from "../util/fs.js";
import { yamlDoubleQuoted } from "../util/yaml.js";

/** Options for {@link writePlan}. */
export interface WritePlanOptions {
  /** Project id written into YAML frontmatter. */
  projectId: string;
  /** When true, overwrite an existing plan (preserving original `created`). */
  force?: boolean;
  /** Timestamp for `created` / `updated` (default: now). */
  now?: Date;
}

export type WritePlanStatus = "created" | "overwritten" | "exists";

export interface WritePlanResult {
  path: string;
  status: WritePlanStatus;
}

function buildFrontmatter(options: {
  projectId: string;
  created: string;
  updated?: string;
}): string {
  const lines = [
    "---",
    `project: ${yamlDoubleQuoted(options.projectId)}`,
    `created: ${yamlDoubleQuoted(options.created)}`,
  ];
  if (options.updated) {
    lines.push(`updated: ${yamlDoubleQuoted(options.updated)}`);
  }
  lines.push("---");
  return `${lines.join("\n")}\n\n`;
}

/**
 * Writes or updates a named plan markdown file under `plansDir` (created if missing).
 * Target is always `plansDir/<name>.md` — no collision suffixes.
 * Without `force`, an existing file is left untouched and status `"exists"` is returned.
 * With `force`, overwrites the body, preserves original `created`, and sets `updated`.
 */
export async function writePlan(
  plansDir: string,
  name: string,
  body: string,
  options: WritePlanOptions,
): Promise<WritePlanResult> {
  const now = options.now ?? new Date();
  await mkdir(plansDir, { recursive: true });

  const filePath = path.join(plansDir, `${name}.md`);
  const exists = await fileExists(filePath);

  if (exists && !options.force) {
    return { path: filePath, status: "exists" };
  }

  let created = now.toISOString();
  let updated: string | undefined;

  if (exists && options.force) {
    const existing = await readFile(filePath, "utf8");
    const fm = parseHandoffFrontmatter(existing);
    created = fm.created ?? created;
    updated = now.toISOString();
  }

  const content =
    buildFrontmatter({
      projectId: options.projectId,
      created,
      updated,
    }) + body;

  await writeFile(filePath, content, "utf8");
  return { path: filePath, status: exists ? "overwritten" : "created" };
}
