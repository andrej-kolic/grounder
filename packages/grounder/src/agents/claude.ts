import path from "node:path";
import { resolveHomeDir } from "../connector/home.js";
import { fileExists } from "../util/fs.js";
import type { AgentAdapter, AgentInstallOptions, AgentInstallResult } from "./types.js";

export const claude: AgentAdapter = {
  id: "claude",
  name: "Claude Code",

  async isInstalled(): Promise<boolean> {
    return fileExists(path.join(resolveHomeDir(), ".claude"));
  },

  async install(_opts: AgentInstallOptions): Promise<AgentInstallResult> {
    // Stub: Claude Code artifact install not yet implemented.
    return { artifacts: {} };
  },
};
