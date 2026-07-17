import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveHomeDir } from "../connector/home.js";
import { fileExists } from "../util/fs.js";
import type { AgentAdapter, AgentInstallOptions, AgentInstallResult } from "./types.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const templateDir = path.join(pkgRoot, "templates", "agents", "cursor", "commands");

export function cursorCommandsDir(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".cursor", "commands");
}

export function grounderNoteCommandPath(homeDir?: string): string {
  return path.join(cursorCommandsDir(homeDir), "grounder-note.md");
}

export const cursor: AgentAdapter = {
  id: "cursor",
  name: "Cursor",

  async isInstalled(): Promise<boolean> {
    return fileExists(path.join(resolveHomeDir(), ".cursor"));
  },

  async install(opts: AgentInstallOptions): Promise<AgentInstallResult> {
    const dest = grounderNoteCommandPath(opts.homeDir);
    const existed = await fileExists(dest);

    if (existed && !opts.force) {
      return { artifacts: { [dest]: "skipped" } };
    }

    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(path.join(templateDir, "grounder-note.md"), dest);
    return { artifacts: { [dest]: existed ? "overwritten" : "created" } };
  },
};
