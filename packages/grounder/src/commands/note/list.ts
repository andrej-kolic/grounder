import { withHomeDir } from "../../connector/home.js";
import { resolveNotesDir } from "../../connector/vault.js";
import { helpExitCode } from "../../help.js";
import { parseArgs } from "../../util/parse-args.js";
import { listNotes } from "../../vault/list-notes.js";
import { writeVaultItemList } from "../output.js";
import { requireLinkedProject } from "../require-linked.js";

const DEFAULT_LIMIT = 5;

/** Options for {@link runNoteListWithOptions} (CLI parsing and tests). */
export interface NoteListOptions {
  /** Directory used to find the linked repo (default: `process.cwd()`). */
  cwd?: string;
  /** Max notes to print, newest first (default: 5). */
  limit?: number;
  /** Override home dir / `GROUNDER_HOME` (tests). */
  homeDir?: string;
}

const USAGE = "Usage: grounder note list [--limit <n>]\n";

function usageError(): number {
  process.stderr.write(USAGE);
  return 1;
}

/**
 * CLI entry for `grounder note list [--limit <n>]`.
 * `--limit` must be a positive integer when provided.
 * @returns Exit code (`0` on success, `1` on usage or config errors).
 */
export async function runNoteList(argv: string[]): Promise<number> {
  const helpCode = helpExitCode(argv, "note list");
  if (helpCode !== null) {
    return helpCode;
  }

  const { positional, flags } = parseArgs(argv);
  if (positional.length > 0) {
    return usageError();
  }

  for (const key of flags.keys()) {
    if (key !== "limit") {
      return usageError();
    }
  }

  const limitRaw = flags.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== undefined) {
    if (typeof limitRaw !== "string") {
      return usageError();
    }
    const trimmed = limitRaw.trim();
    const parsed = Number.parseInt(trimmed, 10);
    if (!/^\d+$/.test(trimmed) || Number.isNaN(parsed) || parsed < 1) {
      return usageError();
    }
    limit = parsed;
  }

  return runNoteListWithOptions({ limit });
}

/**
 * Resolves the linked project, lists recent notes under `notes/` (newest first).
 * Prints a count header (blank line after when non-empty), then each note as a
 * numbered two-line block — `N. ` + full filename stem (including any date
 * prefix), then the indented absolute path — separated by a blank line. The
 * title line ends with two trailing spaces (a Markdown hard line break) so
 * agents can relay stdout into chat and keep title and path on separate
 * rendered lines. When `notes/` is empty, prints `No notes.` only. Same
 * vault/link prerequisites as `grounder note`.
 * @returns Exit code (`0` on success, `1` when vault/link is missing).
 */
export async function runNoteListWithOptions(options: NoteListOptions = {}): Promise<number> {
  return withHomeDir(options.homeDir, async () => {
    const linked = await requireLinkedProject(options.cwd ?? process.cwd());
    if (!linked) {
      return 1;
    }

    const limit = options.limit ?? DEFAULT_LIMIT;
    const notesDir = resolveNotesDir(linked.home, linked.repo);
    const paths = await listNotes(notesDir, { limit });
    writeVaultItemList(paths, limit, { singular: "note", plural: "notes" });
    return 0;
  });
}
