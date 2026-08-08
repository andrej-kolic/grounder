import { describe, expect, it } from "vitest";
import { compareSemver, packageVersionRelation } from "../../src/util/semver.js";

describe("util/semver", () => {
  it("compares major.minor.patch numerically", () => {
    expect(compareSemver("0.3.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareSemver("0.1.0", "0.3.0")).toBeLessThan(0);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("1.10.0", "1.9.0")).toBeGreaterThan(0);
  });

  it("ignores prerelease/build suffixes after the triple", () => {
    expect(compareSemver("1.2.3-beta", "1.2.3")).toBe(0);
    expect(compareSemver("1.2.4+build", "1.2.3")).toBeGreaterThan(0);
  });

  it("returns null when either side is unparseable", () => {
    expect(compareSemver("latest", "0.3.0")).toBeNull();
    expect(compareSemver("0.3.0", "v0.3.0")).toBeNull();
  });

  it("packageVersionRelation maps ahead/behind/differs/match", () => {
    expect(packageVersionRelation("0.3.0", "0.3.0")).toBe("match");
    expect(packageVersionRelation("0.3.0", "0.1.0")).toBe("ahead");
    expect(packageVersionRelation("0.1.0", "0.3.0")).toBe("behind");
    expect(packageVersionRelation("0.3.0-beta", "0.3.0")).toBe("differs");
    expect(packageVersionRelation("latest", "0.3.0")).toBe("differs");
  });
});
