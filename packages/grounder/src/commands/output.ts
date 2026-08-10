/** Shared checklist/snapshot formatting for `doctor` and `status`. */

export function writeSection(title: string): void {
  process.stdout.write(`${title}\n`);
}

/** Append a fix hint (` → cmd`), or empty when none. */
export function fixArrow(fix?: string): string {
  return fix ? ` → ${fix}` : "";
}
