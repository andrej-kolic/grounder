import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSweep } from "../lib/models.mjs";

test("resolveSweep_returnsTheFullDefaultSweep_whenNoFlagsGiven", () => {
  const sweep = resolveSweep([]);
  assert.ok(sweep.length > 1);
  assert.ok(sweep.some((e) => e.name === "haiku" && e.host === "claude"));
});

test("resolveSweep_aBareModelName_crossesEveryHostThatSupportsIt", () => {
  const sweep = resolveSweep(["--models", "sonnet"]);
  const hosts = sweep.map((e) => e.host).sort();
  assert.deepEqual(hosts, ["claude", "cursor-agent"]);
});

test("resolveSweep_anExactLabel_matchesOnlyThatOneRow", () => {
  const sweep = resolveSweep(["--models", "sonnet (cursor-agent)"]);
  assert.equal(sweep.length, 1);
  assert.equal(sweep[0].host, "cursor-agent");
});

test("resolveSweep_hostsFlag_narrowsIndependentlyOfModels", () => {
  const sweep = resolveSweep(["--hosts", "cursor-agent"]);
  assert.ok(sweep.length > 0);
  assert.ok(sweep.every((e) => e.host === "cursor-agent"));
});

test("resolveSweep_combiningModelsAndHosts_pinsAnExactPair", () => {
  const sweep = resolveSweep(["--models", "sonnet", "--hosts", "cursor-agent"]);
  assert.equal(sweep.length, 1);
  assert.equal(sweep[0].name, "sonnet");
  assert.equal(sweep[0].host, "cursor-agent");
});

test("resolveSweep_throws_onAnyUnknownModelToken_evenAmongValidOnes", () => {
  assert.throws(() => resolveSweep(["--models", "sonnet,nope"]), /Unknown --models value/);
});

test("resolveSweep_throws_onAnUnknownHost", () => {
  assert.throws(() => resolveSweep(["--hosts", "nope"]), /Unknown --hosts value/);
});

test("resolveSweep_throws_whenAModelHasNoRowForTheGivenHost", () => {
  // haiku has no cursor-agent entry in the catalog.
  assert.throws(
    () => resolveSweep(["--models", "haiku", "--hosts", "cursor-agent"]),
    /matched nothing/,
  );
});
