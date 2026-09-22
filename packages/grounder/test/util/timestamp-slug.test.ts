import { describe, expect, it } from "vitest";
import {
  collisionSuffix,
  MAX_SLUG_LENGTH,
  slugifyText,
  timestampedBasename,
} from "../../src/util/timestamp-slug.js";

describe("util/timestamp-slug", () => {
  const fixedTime = new Date("2026-06-26T14:30:45.000Z");

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

  it("formats the filename prefix in UTC when the process timezone is not UTC", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const instant = new Date("2026-09-22T08:00:00.000Z");
      expect(timestampedBasename("body", { title: "later", now: instant })).toBe(
        "2026-09-22-080000-later",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previous;
      }
    }
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
