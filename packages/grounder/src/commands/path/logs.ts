import { withHomeDir } from "../../connector/home.js";
import { resolveLogsDir } from "../../connector/vault.js";
import { helpExitCode } from "../../help.js";
import { requireLinkedProject } from "../require-linked.js";

export interface PathLogsOptions {
  cwd?: string;
  homeDir?: string;
}

export async function runPathLogs(argv: string[]): Promise<number> {
  const helpCode = helpExitCode(argv, "path logs");
  if (helpCode !== null) {
    return helpCode;
  }

  return runPathLogsWithOptions({});
}

export async function runPathLogsWithOptions(options: PathLogsOptions = {}): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const linked = await requireLinkedProject(options.cwd ?? process.cwd());
    if (!linked) {
      return 1;
    }

    process.stdout.write(`${resolveLogsDir(linked.home, linked.repo)}\n`);
    return 0;
  });
}
