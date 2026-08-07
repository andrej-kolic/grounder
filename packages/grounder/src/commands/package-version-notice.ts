import { type PackageVersionRelation, packageVersionRelation } from "../util/semver.js";

const MIGRATE = "grounder migrate";
const UPGRADE = "install a newer Grounder";

export interface PackageVersionNotice {
  relation: Exclude<PackageVersionRelation, "match">;
  /** Doctor check message (plain language; versions in parentheses). */
  message: string;
  /** Suggested fix action. */
  fix: string;
  /** One-line stderr banner (includes trailing newlines). */
  banner: string;
  /** `grounder status` value after the Package: label. */
  status: string;
}

/**
 * Plain-language notice when the running Grounder and the version recorded for
 * this machine's configuration disagree.
 */
export function packageVersionNotice(
  running: string,
  recorded: string,
): PackageVersionNotice | null {
  const relation = packageVersionRelation(running, recorded);
  if (relation === "match") {
    return null;
  }

  if (relation === "ahead") {
    return {
      relation,
      message: `Grounder ${running} is installed, but your configuration is still from ${recorded}`,
      fix: MIGRATE,
      banner: `Grounder was updated (${running}). Run \`${MIGRATE}\` to update your configuration.\n\n`,
      status: `configuration outdated — run: ${MIGRATE}`,
    };
  }

  if (relation === "behind") {
    return {
      relation,
      message: `this Grounder (${running}) is older than your configuration (${recorded})`,
      fix: UPGRADE,
      banner: `This Grounder (${running}) is older than your configuration (${recorded}). Install a newer Grounder.\n\n`,
      status: `older than configuration — ${UPGRADE}`,
    };
  }

  return {
    relation: "differs",
    message: `Grounder version (${running}) doesn't match your configuration (${recorded})`,
    fix: MIGRATE,
    banner: `Grounder version doesn't match your configuration. Run \`${MIGRATE}\`.\n\n`,
    status: `doesn't match configuration — run: ${MIGRATE}`,
  };
}
