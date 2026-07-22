import { describe, expect, it } from "vitest";
import {
  MAX_SLUG_LENGTH,
  collisionSuffix,
  slugifyText,
  timestampedBasename,
} from "../../src/util/timestamp-slug.js";

describe("util/timestamp-slug", () => {
  const fixedTime = new Date("2026-06-26T14:30:45");

  it("slugifies first line only", () => {
    expect(slugifyText("first line\nsecond line")).toBe("first-line");
  });

  it(`truncates slug to ${MAX_SLUG_LENGTH} characters`, () => {
    const long = "a".repeat(60);
    expect(slugifyText(long).length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
  });

  it("builds second-precision timestamp-prefixed basename", () => {
    expect(timestampedBasename("Investigate auth middleware", { now: fixedTime })).toBe(
      "2026-06-26-143045-investigate-auth-mid",
    );
  });

  it("uses --title for the slug part", () => {
    expect(timestampedBasename("body", { title: "Custom Title", now: fixedTime })).toBe(
      "2026-06-26-143045-custom-title",
    );
  });

  it("zero-pads collision suffixes so lex sort stays newest-first", () => {
    expect(collisionSuffix(2)).toBe("_02");
    expect(collisionSuffix(10)).toBe("_10");
    const names = [
      "2026-06-26-143000-dup.md",
      "2026-06-26-143000-dup_02.md",
      "2026-06-26-143000-dup_10.md",
    ];
    expect([...names].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))).toEqual([
      "2026-06-26-143000-dup_10.md",
      "2026-06-26-143000-dup_02.md",
      "2026-06-26-143000-dup.md",
    ]);
  });
});
