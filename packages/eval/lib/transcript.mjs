import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Saves `results` as a markdown audit transcript under `<pkgRoot>/.tmp/`,
 * numbered so repeated runs don't clobber each other (`report-<probeSet>-1.md`,
 * `-2.md`, ...). `renderEntry(result)` returns that one result's markdown
 * lines (an array of strings); this only owns the file-naming and per-model
 * heading, which is identical between search and mode-lock.
 * @returns Absolute path of the written file.
 */
export async function saveAuditTranscript(pkgRoot, probeSet, results, renderEntry) {
  const dir = path.join(pkgRoot, ".tmp");
  await mkdir(dir, { recursive: true });
  let n = 1;
  while (
    await readFile(path.join(dir, `report-${probeSet}-${n}.md`))
      .then(() => true)
      .catch(() => false)
  ) {
    n++;
  }
  const filePath = path.join(dir, `report-${probeSet}-${n}.md`);
  const lines = [];
  for (const result of results) {
    lines.push(`# ${result.model}\n\n### ${result.probe}\n`);
    lines.push(...renderEntry(result));
  }
  await writeFile(filePath, lines.join("\n"));
  return filePath;
}
