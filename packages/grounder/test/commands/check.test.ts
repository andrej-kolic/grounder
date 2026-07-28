import { describe, expect, it } from "vitest";
import { failCheck, okCheck, warnCheck } from "../../src/commands/check.js";

describe("commands/check", () => {
  it("okCheck sets level ok", () => {
    expect(okCheck("home", "config present")).toEqual({
      id: "home",
      level: "ok",
      message: "config present",
    });
  });

  it("failCheck sets fail with optional fix", () => {
    expect(failCheck("marker", "missing", "grounder init")).toEqual({
      id: "marker",
      level: "fail",
      message: "missing",
      fix: "grounder init",
    });
    expect(failCheck("vault", "unreachable")).toEqual({
      id: "vault",
      level: "fail",
      message: "unreachable",
    });
  });

  it("warnCheck sets warn with optional fix", () => {
    expect(warnCheck("git", "no repo", "init git")).toEqual({
      id: "git",
      level: "warn",
      message: "no repo",
      fix: "init git",
    });
  });
});
