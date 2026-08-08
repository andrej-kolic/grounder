import { withHomeDir } from "../../connector/home.js";
import { resolveNotesDir } from "../../connector/vault.js";
import { helpExitCode } from "../../help.js";
import { requireLinkedProject } from "../require-linked.js";

export interface PathNotesOptions {
  cwd?: string;
  homeDir?: string;
}

export async function runPathNotes(argv: string[]): Promise<number> {
  const helpCode = helpExitCode(argv, "path notes");
  if (helpCode !== null) {
    return helpCode;
  }

  return runPathNotesWithOptions({});
}

export async function runPathNotesWithOptions(options: PathNotesOptions = {}): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const linked = await requireLinkedProject(options.cwd ?? process.cwd());
    if (!linked) {
      return 1;
    }

    process.stdout.write(`${resolveNotesDir(linked.home, linked.repo)}\n`);
    return 0;
  });
}
