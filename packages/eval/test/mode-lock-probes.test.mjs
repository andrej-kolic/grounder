import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadProbes() {
  const raw = await readFile(path.join(PKG_ROOT, "probes", "mode-lock-probes.json"), "utf8");
  return JSON.parse(raw);
}

function probeById(probes, id) {
  const probe = probes.find((p) => p.id === id);
  assert.ok(probe, `expected a probe named "${id}"`);
  return probe;
}

const REAL_LIST_COMMAND =
  "'/Users/x/.nvm/versions/node/v24.9.0/bin/node' '/Users/x/.grounder/runtime/dist/cli.js' handoff list --head";
const REAL_PEEK_COMMAND =
  "'/Users/x/.nvm/versions/node/v24.9.0/bin/node' '/Users/x/.grounder/runtime/dist/cli.js' handoff peek";
const REAL_WRITE_COMMAND =
  "'/Users/x/.nvm/versions/node/v24.9.0/bin/node' '/Users/x/.grounder/runtime/dist/cli.js' handoff \"body\" --topics \"a,b,c\"";

test("handoff forbiddenCommandPattern matches a real list/peek CLI invocation", async () => {
  const { forbiddenCommandPattern } = probeById(await loadProbes(), "handoff-control");
  const forbidden = new RegExp(forbiddenCommandPattern);
  assert.equal(forbidden.test(REAL_LIST_COMMAND), true);
  assert.equal(forbidden.test(REAL_PEEK_COMMAND), true);
});

test("handoff forbiddenCommandPattern does not match the write-form CLI invocation", async () => {
  const { forbiddenCommandPattern } = probeById(await loadProbes(), "handoff-control");
  const forbidden = new RegExp(forbiddenCommandPattern);
  assert.equal(forbidden.test(REAL_WRITE_COMMAND), false);
});

test("handoff forbiddenCommandPattern does not false-fail on an unrelated command containing the word handoff", async () => {
  // Regression: the review found `cat ~/.cursor/skills/grounder-handoff/SKILL.md`
  // false-failing the old bare-word pattern (`handoff(?!\s+(?:list|peek)\b)`).
  const { forbiddenCommandPattern } = probeById(await loadProbes(), "handoff-control");
  const forbidden = new RegExp(forbiddenCommandPattern);
  assert.equal(forbidden.test("cat ~/.cursor/skills/grounder-handoff/SKILL.md"), false);
  assert.equal(forbidden.test("grep -r handoff ."), false);
});

test("handoff forbiddenCommandPattern does not false-fail on a sandbox path built from the probe's own id", async () => {
  // Regression: caught live — a per-probe scratch dir named after the probe id
  // (e.g. "...recall-flip-to-handoff/repo/") matched the old bare-word pattern
  // via a plain `ls` on the sandbox's own cwd. sandboxKey (lib/sandbox.mjs) now
  // uses an opaque hash instead, but the pattern itself should also not care.
  const { forbiddenCommandPattern } = probeById(await loadProbes(), "handoff-control");
  const forbidden = new RegExp(forbiddenCommandPattern);
  assert.equal(
    forbidden.test("ls -la /tmp/grounder-eval/mode-lock/haiku-recall-flip-to-handoff/repo/"),
    false,
  );
});

test("recall requiredCommandPattern (assertDidJob) matches a real list/peek CLI invocation", async () => {
  const { requiredCommandPattern } = probeById(await loadProbes(), "recall-control");
  const required = new RegExp(requiredCommandPattern);
  assert.equal(required.test(REAL_LIST_COMMAND), true);
  assert.equal(required.test(REAL_PEEK_COMMAND), true);
});

test("recall requiredCommandPattern does not count an unrelated read of the skill file as having done the job", async () => {
  // Regression: the review found `cat .../grounder-handoff/SKILL.md` passing the
  // old bare-word "did job" pattern without ever actually loading a handoff.
  const { requiredCommandPattern } = probeById(await loadProbes(), "recall-control");
  const required = new RegExp(requiredCommandPattern);
  assert.equal(required.test("cat ~/.cursor/skills/grounder-handoff/SKILL.md"), false);
});

test("recall probes carry no forbiddenCommandPattern — the write boundary is graded off vault file state, not command text", async () => {
  for (const id of ["recall-control", "recall-flip-to-handoff", "recall-flip-with-selector"]) {
    const probe = probeById(await loadProbes(), id);
    assert.equal(
      probe.forbiddenCommandPattern,
      undefined,
      `${id} should have no forbiddenCommandPattern`,
    );
  }
});

test("handoff-control carries no requiredCommandPattern — did-job is graded off vault file state, not command text", async () => {
  const probe = probeById(await loadProbes(), "handoff-control");
  assert.equal(probe.requiredCommandPattern, undefined);
  assert.equal(probe.assertDidJob, true);
});
