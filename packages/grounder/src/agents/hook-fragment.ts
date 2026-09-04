/**
 * Generic pieces of the session-hook fragment reconciler shared by
 * `cursor.ts` (flat `hooks.sessionStart` array) and `claude.ts` (nested
 * `hooks.SessionStart` matcher groups, each with its own `hooks` array).
 *
 * Model: Ansible `blockinfile` / Kubernetes Server-Side Apply's sole-owner
 * case — locate every entry a recognizer predicate matches (there may be
 * more than one: a legacy `npx grounder handoff peek` entry alongside a
 * runtime-form one, say), remove all of them, and always converge to exactly
 * one canonical entry. No conflict / `--force` gate — Grounder solely owns
 * this one nested entry, there is nothing a user could have "locally edited"
 * the way a whole skill file can be.
 */

/**
 * Grounder's fragment lives at `hooks.<event>`, so a merge has to read `hooks`
 * as a JSON object. A present-but-non-object `hooks` (an array, a string, a
 * number) is refused rather than replaced: these are shared config files whose
 * unrelated keys Grounder promises to preserve, and silently dropping a value
 * it can't interpret is the one way a merge could destroy user data. Refusing
 * matches how {@link mergeJsonFile} already backs off an unparseable root or a
 * non-object top level — same contract, one level deeper.
 *
 * `null` and absent both mean "nothing there yet" and yield a fresh `{}` —
 * neither carries content a user could lose.
 *
 * Returns a shallow copy, so callers can mutate the result without touching
 * the parsed original (`mergeJsonFile` compares by reference to decide whether
 * anything changed).
 */
export function readHooksObject(
  current: Record<string, unknown>,
  filePath: string,
): Record<string, unknown> {
  const hooks = current.hooks;
  if (hooks === undefined || hooks === null) {
    return {};
  }
  if (typeof hooks !== "object" || Array.isArray(hooks)) {
    throw new Error(`Refusing to modify ${filePath}: "hooks" must be a JSON object`);
  }
  return { ...(hooks as Record<string, unknown>) };
}

/** Remove every entry `isMatch` accepts, preserving order of the rest. */
export function removeMatchingEntries<T>(
  entries: readonly T[],
  isMatch: (entry: T) => boolean,
): T[] {
  return entries.filter((entry) => !isMatch(entry));
}

/**
 * True when `entries` already holds exactly one match and it is byte-for-byte
 * the canonical entry (same keys, same order) — the only case a fragment
 * reconciler should report as already-converged (no write needed). Two
 * matches, zero matches, or a single match with drifted content all count as
 * "not yet converged."
 */
export function isAlreadyConverged<T>(
  entries: readonly T[],
  isMatch: (entry: T) => boolean,
  canonical: T,
): boolean {
  const matches = entries.filter(isMatch);
  return matches.length === 1 && JSON.stringify(matches[0]) === JSON.stringify(canonical);
}
