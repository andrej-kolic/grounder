import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveHomeDir } from "../connector/home.js";
import { fileExists } from "../util/fs.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const templatePath = path.join(pkgRoot, "templates", "cursor", "grounder-note.md");

export function cursorCommandsDir(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".cursor", "commands");
}

export function grounderNoteCommandPath(homeDir?: string): string {
  return path.join(cursorCommandsDir(homeDir), "grounder-note.md");
}

export async function installGrounderNoteCommand(options: {
  force?: boolean;
  homeDir?: string;
} = {}): Promise<"created" | "skipped" | "overwritten"> {
  const dest = grounderNoteCommandPath(options.homeDir);

  if ((await fileExists(dest)) && !options.force) {
    return "skipped";
  }

  const existed = await fileExists(dest);
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(templatePath, dest);
  return existed ? "overwritten" : "created";
}

export async function readGrounderNoteTemplate(): Promise<string> {
  return readFile(templatePath, "utf8");
}
