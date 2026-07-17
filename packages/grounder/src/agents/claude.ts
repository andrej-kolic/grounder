import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveHomeDir } from "../connector/home.js";
import { fileExists } from "../util/fs.js";
import type { AgentAdapter, AgentInstallOptions, AgentInstallResult } from "./types.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const templateDir = path.join(pkgRoot, "templates", "agents", "claude", "commands");

export function claudeCommandsDir(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".claude", "commands");
}

export function grounderNoteCommandPath(homeDir?: string): string {
  return path.join(claudeCommandsDir(homeDir), "grounder-note.md");
}

export const claude: AgentAdapter = {
  id: "claude",
  name: "Claude Code",

  async isInstalled(): Promise<boolean> {
    return fileExists(path.join(resolveHomeDir(), ".claude"));
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
