/**
 * Compare npm-style `major.minor.patch` prefixes.
 * Returns negative / zero / positive like `strcmp`, or `null` if either side
 * lacks a leading `x.y.z` (prerelease/build suffixes after the triple are ignored).
 */
export function compareSemver(a: string, b: string): number | null {
  const parse = (v: string): [number, number, number] | null => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    if (!match) {
      return null;
    }
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };

  const left = parse(a);
  const right = parse(b);
  if (!left || !right) {
    return null;
  }

  for (let i = 0; i < 3; i++) {
    if (left[i] < right[i]) {
      return -1;
    }
    if (left[i] > right[i]) {
      return 1;
    }
  }
  return 0;
}

/** How the running package version relates to the last-recorded ledger version. */
export type PackageVersionRelation = "match" | "ahead" | "behind" | "differs";

export function packageVersionRelation(running: string, recorded: string): PackageVersionRelation {
  if (running === recorded) {
    return "match";
  }
  const cmp = compareSemver(running, recorded);
  if (cmp === null || cmp === 0) {
    // Unparseable, or same x.y.z with different suffix/string form.
    return "differs";
  }
  return cmp > 0 ? "ahead" : "behind";
}
