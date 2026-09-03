import { describe, expect, it } from "vitest";
import { isAlreadyConverged, removeMatchingEntries } from "../../src/agents/hook-fragment.js";

describe("agents/hook-fragment", () => {
  describe("removeMatchingEntries", () => {
    it("filters out every match, preserving order of the rest", () => {
      const entries = [{ id: "a" }, { id: "b" }, { id: "a" }, { id: "c" }];
      expect(removeMatchingEntries(entries, (e) => e.id === "a")).toEqual([
        { id: "b" },
        { id: "c" },
      ]);
    });

    it("returns a new array, never mutates the input", () => {
      const entries = [{ id: "a" }];
      const result = removeMatchingEntries(entries, () => true);
      expect(result).not.toBe(entries);
      expect(entries).toEqual([{ id: "a" }]);
    });
  });

  describe("isAlreadyConverged", () => {
    it("is true only for exactly one match, byte-identical to canonical", () => {
      const canonical = { command: "run" };
      expect(isAlreadyConverged([{ command: "run" }], () => true, canonical)).toBe(true);
    });

    it("is false for zero matches", () => {
      expect(isAlreadyConverged([], () => false, { command: "run" })).toBe(false);
    });

    it("is false for more than one match — the dedup case", () => {
      const canonical = { command: "run" };
      expect(isAlreadyConverged([canonical, canonical], () => true, canonical)).toBe(false);
    });

    it("is false when the single match has drifted from canonical", () => {
      expect(isAlreadyConverged([{ command: "old" }], () => true, { command: "new" })).toBe(false);
    });
  });
});
