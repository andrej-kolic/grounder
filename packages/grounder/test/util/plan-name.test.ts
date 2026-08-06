import { describe, expect, it } from "vitest";
import { MAX_PLAN_NAME_LENGTH, sanitizePlanName } from "../../src/util/plan-name.js";

describe("util/plan-name", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(sanitizePlanName("Implementation Phase 1")).toBe("implementation-phase-1");
  });

  it("strips a trailing .md case-insensitively", () => {
    expect(sanitizePlanName("phase-1.md")).toBe("phase-1");
    expect(sanitizePlanName("phase-1.MD")).toBe("phase-1");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizePlanName("  my-plan  ")).toBe("my-plan");
  });

  it("returns empty string for symbols-only or blank input", () => {
    expect(sanitizePlanName("")).toBe("");
    expect(sanitizePlanName("   ")).toBe("");
    expect(sanitizePlanName("!!!")).toBe("");
    expect(sanitizePlanName(".md")).toBe("");
  });

  it(`caps length at ${MAX_PLAN_NAME_LENGTH} without leaving a trailing hyphen`, () => {
    const long = `${"a".repeat(40)} ${"b".repeat(40)}`;
    const result = sanitizePlanName(long);
    expect(result.length).toBeLessThanOrEqual(MAX_PLAN_NAME_LENGTH);
    expect(result.endsWith("-")).toBe(false);
  });

  it("does not truncate short real plan names", () => {
    expect(sanitizePlanName("grounder-phase-4-session-hooks")).toBe(
      "grounder-phase-4-session-hooks",
    );
  });
});
