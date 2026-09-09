#!/usr/bin/env node

/**
 * Live-agent eval for the `grounder-recall`/`grounder-handoff` mode lock (ticket #102).
 *
 * Spawns one headless agent CLI call per (model, probe) against a disposable
 * sandbox vault, then grades the *actual* Bash commands the CLI reports the
 * model ran (from its own tool-call events) against a forbidden-command
 * pattern — not a self-report, since a model failing the boundary could also
 * misreport having failed it.
 *
 * Usage: pnpm eval:mode-lock [-- --models sonnet,haiku]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSweep } from "./lib/models.mjs";
import { renderTable } from "./lib/report.mjs";
import { runProbe } from "./lib/run-agent.mjs";
import { setupModeLockSandbox } from "./lib/sandbox.mjs";

const PKG_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)));

async function loadProbes() {
  const raw = await readFile(path.join(PKG_ROOT, "probes", "mode-lock-probes.json"), "utf8");
  return JSON.parse(raw);
}

async function saveAuditTranscript(results) {
  const dir = path.join(PKG_ROOT, ".tmp");
  await mkdir(dir, { recursive: true });
  let n = 1;
  while (
    await readFile(path.join(dir, `report-mode-lock-${n}.md`))
      .then(() => true)
      .catch(() => false)
  ) {
    n++;
  }
  const filePath = path.join(dir, `report-mode-lock-${n}.md`);
  const lines = [];
  for (const { model, probe, finalText, commands, error } of results) {
    lines.push(`# ${model}\n\n### ${probe}\n`);
    if (error) {
      lines.push(`ERROR: ${error}\n`);
      continue;
    }
    lines.push(`**Commands run:**\n\n\`\`\`bash\n${(commands ?? []).join("\n")}\n\`\`\`\n`);
    lines.push(`**Final answer:**\n\n${finalText}\n`);
  }
  await writeFile(filePath, lines.join("\n"));
  return filePath;
}

async function main() {
  const sweep = resolveSweep(process.argv);
  const probes = await loadProbes();
  const { homeDir, repoDir, vaultDir } = await setupModeLockSandbox();

  const tasks = sweep.flatMap((modelEntry) =>
    probes.map(async (probe) => {
      const prompt = probe.input ? `/${probe.skill} ${probe.input}` : `/${probe.skill}`;
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
    const forbidden = new RegExp(probe.forbiddenCommandPattern);
    for (const modelEntry of sweep) {
      const result = results.find((r) => r.model === modelEntry.label && r.probe === probe.id);
      if (result.error) {
        rows.push([modelEntry.label, probe.id, "boundary", `(error: ${result.error})`, "FAIL"]);
        failures++;
        continue;
      }

      const crossed = (result.commands ?? []).some((cmd) => forbidden.test(cmd));
      rows.push([
        modelEntry.label,
        probe.id,
        "boundary",
        crossed ? "crossed" : "held",
        crossed ? "FAIL" : "PASS",
      ]);
      if (crossed) {
        failures++;
      }

      if (probe.expectNoticeSubstring) {
        const hasNotice = (result.finalText ?? "").includes(probe.expectNoticeSubstring);
        rows.push([
          modelEntry.label,
          probe.id,
          "notice",
          hasNotice ? "present" : "missing",
          hasNotice ? "PASS" : "FAIL",
        ]);
        if (!hasNotice) {
          failures++;
        }
      }
    }
  }

  process.stdout.write(`Audit transcript: ${transcriptPath}\n\n`);
  process.stdout.write(
    `${renderTable(["Model", "Probe", "Check", "Result", "Verdict"], rows)}\n\n`,
  );

  if (failures > 0) {
    process.stdout.write(`${failures} of ${rows.length} checks FAILED.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`All ${rows.length} checks passed.\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
