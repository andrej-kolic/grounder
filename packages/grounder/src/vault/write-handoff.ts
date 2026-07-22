import { mkdir } from "node:fs/promises";
import { writeUniqueMarkdown } from "../util/fs.js";
import { timestampedBasename } from "../util/timestamp-slug.js";

/** Options for {@link writeHandoff}. */
export interface WriteHandoffOptions {
  /** Project id written into YAML frontmatter. */
  projectId: string;
  /** Optional title slug for the filename and frontmatter. */
  title?: string;
  /** Git branch when known; omitted from frontmatter if unset. */
  branch?: string;
  /** Timestamp for filename prefix and `created` (default: now). */
  now?: Date;
}

function buildFrontmatter(options: {
  projectId: string;
  branch?: string;
  created: string;
  title?: string;
}): string {
  const lines = ["---", `project: ${options.projectId}`];
  if (options.branch) {
    lines.push(`branch: ${options.branch}`);
  }
  lines.push(`created: ${options.created}`);
  if (options.title) {
    lines.push(`title: ${options.title}`);
  }
  lines.push("---");
  return `${lines.join("\n")}\n\n`;
}

/**
 * Writes a new handoff markdown file under `logsDir` (created if missing).
 * Prepends YAML frontmatter (`project`, optional `branch`/`title`, `created`)
 * ahead of `body`. Never overwrites — exclusive create with `_NN` on collision.
 * @param logsDir - Absolute project logs directory.
 * @param body - Agent-supplied markdown (sections such as Done / Next); not validated here.
 * @returns Absolute path of the written file.
 */
export async function writeHandoff(
  logsDir: string,
  body: string,
  options: WriteHandoffOptions,
): Promise<string> {
  const now = options.now ?? new Date();
  await mkdir(logsDir, { recursive: true });

  const basename = timestampedBasename(body, {
    title: options.title,
    now,
  });
  const content =
    buildFrontmatter({
      projectId: options.projectId,
      branch: options.branch,
      created: now.toISOString(),
      title: options.title,
    }) + body;

  return writeUniqueMarkdown(logsDir, basename, content);
}
