#!/usr/bin/env node

/**
 * Live-agent eval for the `grounder-recall`/`grounder-handoff` mode lock (ticket #102).
 *
 * Spawns one headless agent CLI call per (model, probe) against a disposable
 * sandbox vault. Grades the write-side boundary (recall must never add a
 * file to `logs/`; handoff-control must) off the vault's own file listing —
 * ground truth, immune to *how* a write happened (CLI, a raw Bash redirect,
 * a cursor-agent Write/Edit/Delete tool call). The read-side boundary
 * (handoff must never list/peek an existing handoff) has no file-state
 * signature, so that one still comes from the CLI's own reported tool-call
 * events — not a self-report, since a model failing the boundary could also
 * misreport having failed it.
 *
 * Usage: pnpm eval:mode-lock [-- --models sonnet,haiku]
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapWithConcurrency } from "./lib/concurrency.mjs";
import { resolveConcurrency, resolveSweep } from "./lib/models.mjs";
import { assertRuntimeCurrent } from "./lib/preflight.mjs";
import { renderTable } from "./lib/report.mjs";
import { runProbe } from "./lib/run-agent.mjs";
import { sandboxKey, setupModeLockSandbox, wipeModeLockScratch } from "./lib/sandbox.mjs";
import { saveAuditTranscript } from "./lib/transcript.mjs";
import { hasNewFile, listLogFiles } from "./lib/vault-log-files.mjs";

const PKG_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)));

async function loadProbes() {
  const raw = await readFile(path.join(PKG_ROOT, "probes", "mode-lock-probes.json"), "utf8");
  return JSON.parse(raw);
}

function renderTranscriptEntry({ finalText, commands, writes, error }) {
  if (error) {
    return [`ERROR: ${error}\n`];
  }
  const lines = [`**Commands run:**\n\n\`\`\`bash\n${(commands ?? []).join("\n")}\n\`\`\`\n`];
  if (writes && writes.length > 0) {
    lines.push(`**Non-shell writes:**\n\n\`\`\`\n${writes.join("\n")}\n\`\`\`\n`);
  }
  lines.push(`**Final answer:**\n\n${finalText}\n`);
  return lines;
}

async function main() {
  await assertRuntimeCurrent();

  const sweep = resolveSweep(process.argv);
  const concurrency = resolveConcurrency(process.argv);
  const probes = await loadProbes();

  // Keyed by hash of (model, probe), so nothing collides *within* a sweep —
  // but with no cleanup, every sweep ever run on this machine would pile up.
  await wipeModeLockScratch();

  const runs = sweep.flatMap((modelEntry) => probes.map((probe) => ({ modelEntry, probe })));

  const results = await mapWithConcurrency(runs, concurrency, async ({ modelEntry, probe }) => {
    const base = { model: modelEntry.label, probe: probe.id };
    try {
      // Each (model, probe) run gets its own sandbox — otherwise every
      // concurrent run shares one vault, and a sibling's handoff write can
      // change which file is "#2" for the selector probe out from under it.
      const { homeDir, repoDir, vaultDir } = await setupModeLockSandbox(
        sandboxKey(modelEntry, probe),
      );
      const logsBefore = await listLogFiles(vaultDir);
      const prompt = probe.input ? `/${probe.skill} ${probe.input}` : `/${probe.skill}`;
      const outcome = await runProbe(modelEntry, prompt, {
        cwd: repoDir,
        addDir: vaultDir,
        env: { GROUNDER_HOME: homeDir },
      });
      const logsAfter = await listLogFiles(vaultDir);
      return { ...base, wroteNewFile: hasNewFile(logsBefore, logsAfter), ...outcome };
    } catch (error) {
      // A sandbox-setup failure (e.g. a transient seeding hiccup) must not
      // take down every other in-flight probe in the sweep with it —
      // mapWithConcurrency has no try/catch of its own around `fn`.
      return { ...base, error: `Sandbox setup failed: ${error.message}` };
    }
  });
  const transcriptPath = await saveAuditTranscript(
    PKG_ROOT,
    "mode-lock",
    results,
    renderTranscriptEntry,
  );

  const rows = [];
  let failures = 0;
  for (const probe of probes) {
    const forbidden = probe.forbiddenCommandPattern
      ? new RegExp(probe.forbiddenCommandPattern)
      : null;
    const required = probe.requiredCommandPattern ? new RegExp(probe.requiredCommandPattern) : null;
    for (const modelEntry of sweep) {
      const result = results.find((r) => r.model === modelEntry.label && r.probe === probe.id);
      if (result.error) {
        rows.push([modelEntry.label, probe.id, "boundary", `(error: ${result.error})`, "FAIL"]);
        failures++;
        continue;
      }

      // Write-side boundary: ground truth from the vault's own file listing.
      // Read-side boundary (handoff must not list/peek): no file-state
      // signature, so this is still command text — narrowly anchored to an
      // actual CLI invocation (`cli.js' handoff list|peek`), not a bare
      // "handoff" substring, which also matches things like a path
      // (`grounder-handoff/SKILL.md`) that were never a real crossing.
      const crossed = forbidden
        ? (result.commands ?? []).some((cmd) => forbidden.test(cmd))
        : result.wroteNewFile;
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

      // "Never crossed the boundary" also passes on a model that did
      // nothing at all — control probes (assertDidJob) check the model
      // actually did its one job, not just that it avoided the other
      // skill's job. Write-side (handoff-control) is ground truth again;
      // read-side (recall-control) is the same anchored CLI-invocation
      // pattern.
      if (probe.assertDidJob) {
        const didJob = required
          ? (result.commands ?? []).some((cmd) => required.test(cmd))
          : result.wroteNewFile;
        rows.push([
          modelEntry.label,
          probe.id,
          "did job",
          didJob ? "ran" : "no-op",
          didJob ? "PASS" : "FAIL",
        ]);
        if (!didJob) {
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
