import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveConcurrency } from "../lib/models.mjs";

test("returnsDefaultOfFour_whenFlagAbsent", () => {
  assert.equal(resolveConcurrency([]), 4);
});

test("parsesAPositiveIntegerFlag", () => {
  assert.equal(resolveConcurrency(["--concurrency", "2"]), 2);
});

test("rejectsATrailingNonDigitToken", () => {
  assert.throws(() => resolveConcurrency(["--concurrency", "4foo"]), /positive integer/);
});

test("rejectsADecimalToken", () => {
  assert.throws(() => resolveConcurrency(["--concurrency", "1.5"]), /positive integer/);
});

test("rejectsZeroAndNegativeTokens", () => {
  assert.throws(() => resolveConcurrency(["--concurrency", "0"]), /positive integer/);
  assert.throws(() => resolveConcurrency(["--concurrency", "-1"]), /positive integer/);
});
