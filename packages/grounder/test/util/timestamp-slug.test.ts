import { describe, expect, it } from "vitest";
import {
  MAX_SLUG_LENGTH,
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

  it("builds timestamp-prefixed basename", () => {
    expect(timestampedBasename("Investigate auth middleware", { now: fixedTime })).toBe(
      "2026-06-26-1430-investigate-auth-mid",
    );
  });

  it("uses --title for the slug part", () => {
    expect(timestampedBasename("body", { title: "Custom Title", now: fixedTime })).toBe(
      "2026-06-26-1430-custom-title",
    );
  });
});
