#!/usr/bin/env node

/**
 * Live-agent eval for the `/grounder-search` skill prompt (ticket #102).
 *
 * Spawns one headless agent CLI call per (model, probe) against a sandboxed,
 * seeded fixture vault (`fixtures/eval-vault`) — a real slash-command turn,
 * not a direct CLI invocation, since the thing under test is whether a model
 * follows the skill prompt, not whether the CLI ranks correctly (that's
 * already covered by packages/grounder/test/vault/search.test.ts).
 *
 * Usage: pnpm eval:search [-- --models sonnet,haiku]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSweep } from "./lib/models.mjs";
import { linksUnderHeading, renderTable } from "./lib/report.mjs";
import { runProbe } from "./lib/run-agent.mjs";
import { setupSearchSandbox } from "./lib/sandbox.mjs";

const PKG_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)));

async function loadProbes() {
  const raw = await readFile(path.join(PKG_ROOT, "probes", "search-probes.json"), "utf8");
  return JSON.parse(raw);
}

async function saveAuditTranscript(results) {
  const dir = path.join(PKG_ROOT, ".tmp");
  await mkdir(dir, { recursive: true });
  let n = 1;
  while (
    await readFile(path.join(dir, `report-search-${n}.md`))
      .then(() => true)
      .catch(() => false)
  ) {
    n++;
  }
  const filePath = path.join(dir, `report-search-${n}.md`);
  const lines = [];
  for (const { model, probe, finalText, error } of results) {
    lines.push(`# ${model}\n\n### ${probe}\n`);
    lines.push(error ? `ERROR: ${error}\n` : `${finalText}\n`);
  }
  await writeFile(filePath, lines.join("\n"));
  return filePath;
}

async function main() {
  const sweep = resolveSweep(process.argv);
  const probes = await loadProbes();
  const { homeDir, repoDir, vaultDir } = await setupSearchSandbox();

  const tasks = sweep.flatMap((modelEntry) =>
    probes.map(async (probe) => {
      const prompt = `/grounder-search ${probe.input}`;
      const outcome = await runProbe(modelEntry, prompt, {
        cwd: repoDir,
        addDir: vaultDir,
        env: { GROUNDER_HOME: homeDir },
      });
      return { model: modelEntry.label, probe: probe.id, ...outcome };
    }),
  );

  const results = await Promise.all(tasks);
  const transcriptPath = await saveAuditTranscript(results);

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
