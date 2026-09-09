import assert from "node:assert/strict";
import { test } from "node:test";
import { mapWithConcurrency } from "../lib/concurrency.mjs";

test("preservesInputOrder_regardlessOfCompletionOrder", async () => {
  const delaysMs = [30, 10, 20];
  const results = await mapWithConcurrency(
    delaysMs,
    3,
    (ms) => new Promise((resolve) => setTimeout(() => resolve(ms), ms)),
  );
  assert.deepEqual(results, delaysMs);
});

test("neverRunsMoreThanLimitAtOnce", async () => {
  let active = 0;
  let maxActive = 0;
  const items = Array.from({ length: 10 }, (_, i) => i);
  await mapWithConcurrency(items, 3, async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
  });
  assert.ok(maxActive <= 3, `expected at most 3 concurrent, saw ${maxActive}`);
});

test("returnsEmptyArray_whenItemsEmpty", async () => {
  const results = await mapWithConcurrency([], 4, () => {
    throw new Error("fn should never be called for an empty input");
  });
  assert.deepEqual(results, []);
});
