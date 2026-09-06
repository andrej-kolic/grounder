import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareVersions,
  invokeCli,
  meetsMinVersion,
  parseVersion,
  runtimeCliPathFor,
} from "../src/cli.js";

describe("runtimeCliPathFor", () => {
  it("joins the runtime dist/cli.js path under the given home dir", () => {
    expect(runtimeCliPathFor("/home/rey")).toBe(
      path.join("/home/rey", ".grounder", "runtime", "dist", "cli.js"),
    );
  });
});

describe("parseVersion", () => {
  it("parses a plain semver string", () => {
    expect(parseVersion("0.6.0")).toEqual({
      major: 0,
      minor: 6,
      patch: 0,
      prerelease: null,
    });
  });

  it("parses a prerelease suffix", () => {
    expect(parseVersion("0.6.0-dev.2")).toEqual({
      major: 0,
      minor: 6,
      patch: 0,
      prerelease: "dev.2",
    });
  });

  it("returns null for garbage", () => {
    expect(parseVersion("not-a-version")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders by major/minor/patch", () => {
    expect(compareVersions("0.6.0", "0.5.9")).toBeGreaterThan(0);
    expect(compareVersions("0.5.9", "0.6.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("treats a prerelease as equal to its own release (ignores -prerelease)", () => {
    expect(compareVersions("0.6.0-dev.2", "0.6.0")).toBe(0);
    expect(compareVersions("0.6.0", "0.6.0-dev.2")).toBe(0);
    expect(compareVersions("0.6.0-dev.2", "0.6.0-dev.9")).toBe(0);
  });

  it("returns null when either side fails to parse", () => {
    expect(compareVersions("garbage", "0.6.0")).toBeNull();
    expect(compareVersions("0.6.0", "garbage")).toBeNull();
  });
});

describe("meetsMinVersion", () => {
  it("accepts a version at or above the floor", () => {
    expect(meetsMinVersion("0.6.0", "0.6.0")).toBe(true);
    expect(meetsMinVersion("0.7.0", "0.6.0")).toBe(true);
  });

  it("rejects a version below the floor", () => {
    expect(meetsMinVersion("0.5.0", "0.6.0")).toBe(false);
  });

  it('accepts a dev prerelease of the floor version (not "older" than it)', () => {
    expect(meetsMinVersion("0.6.0-dev.2", "0.6.0")).toBe(true);
  });

  it("is lenient (treats as met) when the version string is unparsable", () => {
    expect(meetsMinVersion("weird-build-tag", "0.6.0")).toBe(true);
  });
});

describe("invokeCli", () => {
  const originalHome = process.env.GROUNDER_HOME;
  let tempHome: string | undefined;

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.GROUNDER_HOME;
    } else {
      process.env.GROUNDER_HOME = originalHome;
    }
    if (tempHome) {
      await rm(tempHome, { recursive: true, force: true });
      tempHome = undefined;
    }
  });

  it("reports no-runtime when the materialized CLI doesn't exist", async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "grounder-vscode-ext-"));
    process.env.GROUNDER_HOME = tempHome;

    // Regression test: `spawn` only raises its own ENOENT when the executable
    // itself (process.execPath, always present) is missing — a missing
    // *argument* path just makes Node start and crash with MODULE_NOT_FOUND
    // and a non-zero exit code, which used to be misreported as a generic
    // "error" instead of "no-runtime".
    const result = await invokeCli(["--version"]);
    expect(result).toEqual({ kind: "no-runtime" });
  });
});
