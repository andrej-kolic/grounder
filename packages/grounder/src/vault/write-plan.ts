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
  /** 3-5 topic keywords for search (flat list, omitted when empty/unset). */
  topics?: string[];
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
  topics?: string[];
}): string {
  const lines = [
    "---",
    `project: ${yamlDoubleQuoted(options.projectId)}`,
    `created: ${yamlDoubleQuoted(options.created)}`,
  ];
  if (options.updated) {
    lines.push(`updated: ${yamlDoubleQuoted(options.updated)}`);
  }
  if (options.topics && options.topics.length > 0) {
    const items = options.topics.map((t) => yamlDoubleQuoted(t)).join(", ");
    lines.push(`topics: [${items}]`);
  }
  lines.push("---");
  return `${lines.join("\n")}\n\n`;
}

/**
 * Overwrites an existing plan at an absolute path.
 * Preserves original `created` (falls back to `now` if missing) and sets `updated`.
 * Caller must validate the path (e.g. inside this project's `plans/` dir).
 */
export async function updatePlanAtPath(
  filePath: string,
  body: string,
  options: Omit<WritePlanOptions, "force">,
): Promise<WritePlanResult> {
  const now = options.now ?? new Date();
  const existing = await readFile(filePath, "utf8");
  const fm = parseHandoffFrontmatter(existing);
  const created = fm.created ?? now.toISOString();
  const updated = now.toISOString();

  const content =
    buildFrontmatter({
      projectId: options.projectId,
      created,
      updated,
      topics: options.topics,
    }) + body;

  await writeFile(filePath, content, "utf8");
  return { path: filePath, status: "overwritten" };
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

  if (exists && options.force) {
    return updatePlanAtPath(filePath, body, {
      projectId: options.projectId,
      topics: options.topics,
      now,
    });
  }

  const content =
    buildFrontmatter({
      projectId: options.projectId,
      created: now.toISOString(),
      topics: options.topics,
    }) + body;

  await writeFile(filePath, content, "utf8");
  return { path: filePath, status: "created" };
}
