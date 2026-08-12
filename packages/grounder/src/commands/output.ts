import path from "node:path";

/** Shared checklist/snapshot formatting for `doctor` and `status`. */

export function writeSection(title: string): void {
  process.stdout.write(`${title}\n`);
}

/** Append a fix hint (` → cmd`), or empty when none. */
export function fixArrow(fix?: string): string {
  return fix ? ` → ${fix}` : "";
}

/** Singular/plural labels for vault item list headers (`note`/`notes`, …). */
export type VaultItemListNoun = {
  singular: string;
  plural: string;
};

function vaultItemNoun(count: number, noun: VaultItemListNoun): string {
  return count === 1 ? noun.singular : noun.plural;
}

/**
 * Lead line for note/handoff/plan list stdout: truncation signal when
 * `count === limit`, complete inventory when fewer, or empty-dir notice.
 */
export function formatVaultItemListHeader(
  count: number,
  limit: number,
  noun: VaultItemListNoun,
): string {
  if (count === 0) {
    return `No ${noun.plural}.\n`;
  }
  const label = vaultItemNoun(count, noun);
  if (count === limit) {
    return `Most recent ${count} ${label} (there may be more):\n\n`;
  }
  return `All ${count} ${label}:\n\n`;
}

/**
 * Writes numbered title + absolute-path blocks (blank line between items).
 * Each title line ends with two trailing spaces (a Markdown hard line break)
 * so agents can relay stdout into chat and keep title and path on separate
 * rendered lines.
 */
export function writeVaultItemListEntries(paths: readonly string[]): void {
  paths.forEach((filePath, index) => {
    if (index > 0) {
      process.stdout.write("\n");
    }
    const stem = path.basename(filePath, ".md");
    // Two trailing spaces: Markdown hard break when stdout is relayed into chat.
    process.stdout.write(`${index + 1}. ${stem}  \n  ${filePath}\n`);
  });
}

/**
 * Count header + numbered title/path blocks for vault item lists.
 * When `paths` is empty, prints only the empty-dir notice from the header.
 */
export function writeVaultItemList(
  paths: readonly string[],
  limit: number,
  noun: VaultItemListNoun,
): void {
  process.stdout.write(formatVaultItemListHeader(paths.length, limit, noun));
  writeVaultItemListEntries(paths);
}
