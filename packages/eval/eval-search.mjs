#!/usr/bin/env node

/**
 * Live-agent eval for the `/grounder-search` skill prompt (ticket #102).
 *
 * Spawns one headless agent CLI call per (model, probe) against a sandboxed,
 * disposable copy of the seeded fixture vault (`fixtures/eval-vault`) — a
 * real slash-command turn,
 * not a direct CLI invocation, since the thing under test is whether a model
 * follows the skill prompt, not whether the CLI ranks correctly (that's
 * already covered by packages/grounder/test/vault/search.test.ts).
 *
 * Usage: pnpm eval:search [-- --models sonnet,haiku]
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapWithConcurrency } from "./lib/concurrency.mjs";
import { resolveConcurrency, resolveSweep } from "./lib/models.mjs";
import { assertRuntimeCurrent } from "./lib/preflight.mjs";
import { linksUnderHeading, renderTable } from "./lib/report.mjs";
import { runProbe } from "./lib/run-agent.mjs";
import { sandboxKey, setupSearchRepoDir, setupSearchSandbox } from "./lib/sandbox.mjs";
import { saveAuditTranscript } from "./lib/transcript.mjs";

const PKG_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)));

async function loadProbes() {
  const raw = await readFile(path.join(PKG_ROOT, "probes", "search-probes.json"), "utf8");
  return JSON.parse(raw);
}

function renderTranscriptEntry({ finalText, error }) {
  return [error ? `ERROR: ${error}\n` : `${finalText}\n`];
}

async function main() {
  await assertRuntimeCurrent();

  const sweep = resolveSweep(process.argv);
  const concurrency = resolveConcurrency(process.argv);
  const probes = await loadProbes();
  const { homeDir, vaultDir } = await setupSearchSandbox();

  const runs = sweep.flatMap((modelEntry) => probes.map((probe) => ({ modelEntry, probe })));

  const results = await mapWithConcurrency(runs, concurrency, async ({ modelEntry, probe }) => {
    const base = { model: modelEntry.label, probe: probe.id };
    try {
      // Each (model, probe) run gets its own repo dir — the vault itself is
      // shared and locked read-only, but sharing one `--workspace` cwd
      // across concurrent CLI processes risks each host's own per-project
      // session-file writes colliding.
      const repoDir = await setupSearchRepoDir(sandboxKey(modelEntry, probe));
      const prompt = `/grounder-search ${probe.input}`;
      const outcome = await runProbe(modelEntry, prompt, {
        cwd: repoDir,
        addDir: vaultDir,
        env: { GROUNDER_HOME: homeDir },
      });
      return { ...base, ...outcome };
    } catch (error) {
      // A sandbox-setup failure must not take down every other in-flight
      // probe with it — mapWithConcurrency has no try/catch of its own.
      return { ...base, error: `Sandbox setup failed: ${error.message}` };
    }
  });
  const transcriptPath = await saveAuditTranscript(
    PKG_ROOT,
    "search",
    results,
    renderTranscriptEntry,
  );

  const rows = [];
  let failures = 0;
  for (const probe of probes) {
    for (const modelEntry of sweep) {
      const result = results.find((r) => r.model === modelEntry.label && r.probe === probe.id);
      if (result.error) {
        rows.push([
          modelEntry.label,
          probe.id,
          probe.expectedTopRelativePaths[0],
          `(error: ${result.error})`,
          "FAIL",
        ]);
        failures++;
        continue;
      }

      // The vault copy is chmod'd read-only, so an attempted write can't
      // actually corrupt anything — but a cursor-agent Write/Edit/Delete
      // attempt is still a boundary violation worth failing loudly on,
      // not a silent pass just because the ranking answer still came out
      // right. (Claude's writes aren't tracked here: --allowedTools "Bash
      // Read" already keeps it off any non-shell mutation tool.)
      const attemptedWrite = (result.writes ?? []).length > 0;
      if (attemptedWrite) {
        rows.push([modelEntry.label, probe.id, "(read-only vault)", "attempted write", "FAIL"]);
        failures++;
      }

      const top = linksUnderHeading(result.finalText, "Read these")[0]?.title ?? "(none)";
      const pass = probe.expectedTopRelativePaths.includes(top);
      rows.push([
        modelEntry.label,
        probe.id,
        probe.expectedTopRelativePaths.join(" | "),
        top,
        pass ? "PASS" : "FAIL",
      ]);
      if (!pass) {
        failures++;
      }
    }
  }

  process.stdout.write(`Audit transcript: ${transcriptPath}\n\n`);
  process.stdout.write(
    `${renderTable(["Model", "Probe", "Expected top", "Got top", "Result"], rows)}\n\n`,
  );

  if (failures > 0) {
    process.stdout.write(`${failures} of ${rows.length} probe runs FAILED.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`All ${rows.length} probe runs passed.\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
