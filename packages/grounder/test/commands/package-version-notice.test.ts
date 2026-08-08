import { describe, expect, it } from "vitest";
import { packageVersionNotice } from "../../src/commands/package-version-notice.js";

describe("commands/package-version-notice", () => {
  it("returns null when versions match exactly", () => {
    expect(packageVersionNotice("0.3.0", "0.3.0")).toBeNull();
  });

  it("tells the user to migrate after an upgrade", () => {
    expect(packageVersionNotice("0.3.0", "0.1.0")).toEqual({
      relation: "ahead",
      message: "Grounder 0.3.0 is installed, but your configuration is still from 0.1.0",
      fix: "grounder migrate",
      banner:
        "Grounder was updated (0.3.0). Run `grounder migrate` to update your configuration.\n\n",
      status: "configuration outdated — run: grounder migrate",
    });
  });

  it("tells the user to install a newer package when running behind", () => {
    expect(packageVersionNotice("0.1.0", "0.3.0")).toEqual({
      relation: "behind",
      message: "this Grounder (0.1.0) is older than your configuration (0.3.0)",
      fix: "install a newer Grounder",
      banner:
        "This Grounder (0.1.0) is older than your configuration (0.3.0). Install a newer Grounder.\n\n",
      status: "older than configuration — install a newer Grounder",
    });
  });

  it("uses plain mismatch copy when versions are incomparable", () => {
    expect(packageVersionNotice("latest", "0.3.0")).toEqual({
      relation: "differs",
      message: "Grounder version (latest) doesn't match your configuration (0.3.0)",
      fix: "grounder migrate",
      banner: "Grounder version doesn't match your configuration. Run `grounder migrate`.\n\n",
      status: "doesn't match configuration — run: grounder migrate",
    });
  });
});
