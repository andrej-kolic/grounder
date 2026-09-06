import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Bare existence check for `.grounder.json`, walking from `startDir` up to
 * the filesystem root — mirrors the CLI's own `findLinkedRepoRoot` walk, but
 * never opens or parses the file.
 *
 * Narrow, deliberate exception to "never read Grounder's internal
 * config/state files directly": this checks only whether `.grounder.json`
 * exists, never its contents, and never touches `state.json`/`config.json`.
 * It exists solely to tell "never linked anywhere" apart from "linked, but
 * `grounder setup`/`migrate` was never run on this machine" when the runtime
 * itself isn't materialized yet (see `resolveFolderState`'s `no-runtime`
 * handling) — a case `status --json` can't answer, since there's no runtime
 * to invoke it with.
 */
export function hasGrounderMarkerUpward(startDir: string): boolean {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, ".grounder.json"))) {
      return true;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return false;
    }
    dir = parent;
  }
}
