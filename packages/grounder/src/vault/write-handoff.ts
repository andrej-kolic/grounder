import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../util/fs.js";
import {
  timestampedBasename,
  timestampedBasenameWithSeconds,
} from "../util/timestamp-slug.js";

export interface WriteHandoffOptions {
  projectId: string;
  title?: string;
  branch?: string;
  now?: Date;
}

async function resolveHandoffPath(
  logsDir: string,
  body: string,
  options: { title?: string; now: Date },
): Promise<string> {
  const slugOptions = { title: options.title, now: options.now };
  let basename = timestampedBasename(body, slugOptions);
  let filePath = path.join(logsDir, `${basename}.md`);

  if (await fileExists(filePath)) {
    basename = timestampedBasenameWithSeconds(body, slugOptions);
    filePath = path.join(logsDir, `${basename}.md`);
  }

  if (await fileExists(filePath)) {
    let n = 2;
    while (await fileExists(path.join(logsDir, `${basename}-${n}.md`))) {
      n += 1;
    }
    filePath = path.join(logsDir, `${basename}-${n}.md`);
  }

  return filePath;
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

export async function writeHandoff(
  logsDir: string,
  body: string,
  options: WriteHandoffOptions,
): Promise<string> {
  const now = options.now ?? new Date();
  await mkdir(logsDir, { recursive: true });

  const filePath = await resolveHandoffPath(logsDir, body, {
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

  await writeFile(filePath, content, "utf8");
  return filePath;
}
