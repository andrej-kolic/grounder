import { withHomeDir } from "../../connector/home.js";
import { resolvePlansDir } from "../../connector/vault.js";
import { helpExitCode } from "../../help.js";
import { requireLinkedProject } from "../require-linked.js";

export interface PathPlansOptions {
  cwd?: string;
  homeDir?: string;
}

export async function runPathPlans(argv: string[]): Promise<number> {
  const helpCode = helpExitCode(argv, "path plans");
  if (helpCode !== null) {
    return helpCode;
  }

  return runPathPlansWithOptions({});
}

export async function runPathPlansWithOptions(options: PathPlansOptions = {}): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const linked = await requireLinkedProject(options.cwd ?? process.cwd());
    if (!linked) {
      return 1;
    }

    process.stdout.write(`${resolvePlansDir(linked.home, linked.repo)}\n`);
    return 0;
  });
}
