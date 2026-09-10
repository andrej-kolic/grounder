import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { hasNewFile, listLogFiles } from "../lib/vault-log-files.mjs";

let vaultDir;

before(async () => {
  vaultDir = await mkdtemp(path.join(os.tmpdir(), "vault-log-files-test-"));
});

after(async () => {
  await rm(vaultDir, { recursive: true, force: true });
});

test("listLogFiles_returnsEmptySet_whenLogsDirDoesNotExistYet", async () => {
  const files = await listLogFiles(vaultDir);
  assert.deepEqual([...files], []);
});

test("listLogFiles_returnsBasenamesInLogsDir_whenPresent", async () => {
  const logsDir = path.join(vaultDir, "10-Projects", "eval-mode-lock", "logs");
  await mkdir(logsDir, { recursive: true });
  await writeFile(path.join(logsDir, "seed-1.md"), "# seed 1");
  await writeFile(path.join(logsDir, "seed-2.md"), "# seed 2");

  const files = await listLogFiles(vaultDir);
  assert.deepEqual([...files].sort(), ["seed-1.md", "seed-2.md"]);
});

test("hasNewFile_true_whenAfterContainsAFileNotInBefore", () => {
  const before = new Set(["seed-1.md", "seed-2.md"]);
  const after = new Set(["seed-1.md", "seed-2.md", "written.md"]);
  assert.equal(hasNewFile(before, after), true);
});

test("hasNewFile_false_whenAfterIsTheSameOrASubsetOfBefore", () => {
  const before = new Set(["seed-1.md", "seed-2.md"]);
  assert.equal(hasNewFile(before, new Set(before)), false);
  assert.equal(hasNewFile(before, new Set(["seed-1.md"])), false);
  assert.equal(hasNewFile(before, new Set()), false);
});
