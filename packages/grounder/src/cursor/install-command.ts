import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fileExists } from "../config.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const templatePath = path.join(pkgRoot, "templates", "cursor", "grounder-note.md");

export function cursorCommandsDir(homeDir?: string): string {
  const base = homeDir ?? process.env.GROUNDER_HOME ?? process.env.HOME ?? "";
  return path.join(base, ".cursor", "commands");
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
