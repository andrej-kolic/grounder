import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveHomeDir } from "../connector/home.js";
import { fileExists } from "../util/fs.js";
import type { AgentAdapter, AgentInstallOptions, AgentInstallResult, ArtifactStatus } from "./types.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const templateDir = path.join(pkgRoot, "templates", "agents", "claude", "commands");

const COMMANDS = ["grounder-note.md", "grounder-task-handoff.md"] as const;

export function claudeCommandsDir(homeDir?: string): string {
  return path.join(resolveHomeDir(homeDir), ".claude", "commands");
}

export function grounderNoteCommandPath(homeDir?: string): string {
  return path.join(claudeCommandsDir(homeDir), "grounder-note.md");
}

export function grounderTaskHandoffCommandPath(homeDir?: string): string {
  return path.join(claudeCommandsDir(homeDir), "grounder-task-handoff.md");
}

async function installCommand(
  filename: (typeof COMMANDS)[number],
  opts: AgentInstallOptions,
): Promise<{ dest: string; status: ArtifactStatus }> {
  const dest = path.join(claudeCommandsDir(opts.homeDir), filename);
  const existed = await fileExists(dest);

  if (existed && !opts.force) {
    return { dest, status: "skipped" };
  }

  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(path.join(templateDir, filename), dest);
  return { dest, status: existed ? "overwritten" : "created" };
}

export const claude: AgentAdapter = {
  id: "claude",
  name: "Claude Code",

  async isInstalled(): Promise<boolean> {
    return fileExists(path.join(resolveHomeDir(), ".claude"));
  },

  async install(opts: AgentInstallOptions): Promise<AgentInstallResult> {
    const artifacts: Record<string, ArtifactStatus> = {};
    for (const filename of COMMANDS) {
      const { dest, status } = await installCommand(filename, opts);
      artifacts[dest] = status;
    }
    return { artifacts };
  },
};
