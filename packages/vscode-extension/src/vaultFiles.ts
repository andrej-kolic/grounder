import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Controls `listVaultDocs`'s sort order — not tied to the three built-in
 * categories, since a discovered vault folder outside notes/handoffs/plans
 * (see {@link listExtraVaultFolders}) sorts the same as notes/plans do.
 */
export type SortKind = "handoffs" | "generic";

export interface VaultDoc {
  /** Absolute path on disk. */
  filePath: string;
  /** Path relative to the category's directory (`dir` passed to {@link listVaultDocs}). */
  relativePath: string;
  /** File stem, for display. */
  label: string;
}

/** Recursively lists `*.md` files under `dir` (absolute paths). Missing dirs yield `[]`. */
async function listMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(full);
      }
    }
  }

  await walk(dir);
  return results;
}

/**
 * Lists vault markdown docs under `dir`, sorted to match the CLI's own list
 * commands: handoffs newest-basename-first (timestamp-prefixed names sort
 * correctly), notes/plans newest-mtime-first. Ties break by relative path
 * descending, for stable ordering.
 */
export async function listVaultDocs(dir: string, sortKind: SortKind): Promise<VaultDoc[]> {
  const files = await listMarkdownFiles(dir);

  if (sortKind === "handoffs") {
    const ranked = files.map((filePath) => ({
      filePath,
      name: path.basename(filePath),
      relativePath: path.relative(dir, filePath),
    }));
    ranked.sort((a, b) => {
      if (a.name !== b.name) {
        return a.name < b.name ? 1 : -1;
      }
      return a.relativePath < b.relativePath ? 1 : a.relativePath > b.relativePath ? -1 : 0;
    });
    return ranked.map((entry) => ({
      filePath: entry.filePath,
      relativePath: entry.relativePath,
      label: path.basename(entry.filePath, ".md"),
    }));
  }

  const withMtime = await Promise.all(
    files.map(async (filePath) => {
      const { mtimeMs } = await stat(filePath);
      return { filePath, relativePath: path.relative(dir, filePath), mtimeMs };
    }),
  );
  withMtime.sort((a, b) => {
    if (a.mtimeMs !== b.mtimeMs) {
      return b.mtimeMs - a.mtimeMs;
    }
    return a.relativePath < b.relativePath ? 1 : a.relativePath > b.relativePath ? -1 : 0;
  });
  return withMtime.map((entry) => ({
    filePath: entry.filePath,
    relativePath: entry.relativePath,
    label: path.basename(entry.filePath, ".md"),
  }));
}

/**
 * Lists subfolders directly under `vaultRoot` that aren't one of `knownDirs`
 * (the notes/logs/plans dirs already shown as their own category) or a
 * dotfolder (Obsidian's own `.obsidian`/`.trash`), so the tree can also
 * surface a project's own ad hoc vault folders (e.g. a hand-made
 * `discussions/`). Sorted case-insensitively by name.
 */
export async function listExtraVaultFolders(
  vaultRoot: string,
  knownDirs: readonly string[],
): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(vaultRoot, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const known = new Set(knownDirs);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(vaultRoot, entry.name))
    .filter((dir) => !known.has(dir))
    .sort((a, b) =>
      path.basename(a).localeCompare(path.basename(b), undefined, { sensitivity: "base" }),
    );
}

/**
 * Lists `*.md` files directly in `vaultRoot` itself (not recursing into
 * subfolders — those surface separately via the three built-in categories or
 * {@link listExtraVaultFolders}), so loose top-level docs in a project's
 * vault folder aren't hidden. Sorted newest-mtime-first, same convention as
 * `listVaultDocs`'s "generic" sort.
 */
export async function listVaultRootFiles(vaultRoot: string): Promise<VaultDoc[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(vaultRoot, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."))
    .map((entry) => path.join(vaultRoot, entry.name));

  const withMtime = await Promise.all(
    files.map(async (filePath) => {
      const { mtimeMs } = await stat(filePath);
      return { filePath, relativePath: path.basename(filePath), mtimeMs };
    }),
  );
  withMtime.sort((a, b) => {
    if (a.mtimeMs !== b.mtimeMs) {
      return b.mtimeMs - a.mtimeMs;
    }
    return a.relativePath < b.relativePath ? 1 : a.relativePath > b.relativePath ? -1 : 0;
  });
  return withMtime.map((entry) => ({
    filePath: entry.filePath,
    relativePath: entry.relativePath,
    label: path.basename(entry.filePath, ".md"),
  }));
}

export type VaultTreeNode =
  | { kind: "folder"; name: string; relativePath: string; children: VaultTreeNode[] }
  | { kind: "doc"; doc: VaultDoc };

interface MutableFolder {
  kind: "folder";
  name: string;
  relativePath: string;
  children: Array<MutableFolder | { kind: "doc"; doc: VaultDoc }>;
}

function isFolder(node: MutableFolder["children"][number]): node is MutableFolder {
  return node.kind === "folder";
}

/**
 * Groups a flat, already-ranked `VaultDoc[]` (see {@link listVaultDocs}) into a
 * real folder tree by splitting each `relativePath` on its directory
 * segments, mirroring VS Code's own Explorer: subfolders before files at
 * every level, both sorted case-insensitively by name. Docs keep the
 * category's existing rank (mtime / handoff-name) within their folder, since
 * partitioning folders out of `children` is stable.
 */
export function buildVaultTree(docs: VaultDoc[]): VaultTreeNode[] {
  const root: MutableFolder = { kind: "folder", name: "", relativePath: "", children: [] };

  for (const doc of docs) {
    const segments = doc.relativePath.split(path.sep).filter(Boolean);
    segments.pop(); // file name — the doc itself is appended below
    let current = root;
    let accPath = "";
    for (const segment of segments) {
      accPath = accPath ? path.join(accPath, segment) : segment;
      let next = current.children.find((child) => isFolder(child) && child.name === segment);
      if (!next) {
        next = { kind: "folder", name: segment, relativePath: accPath, children: [] };
        current.children.push(next);
      }
      current = next as MutableFolder;
    }
    current.children.push({ kind: "doc", doc });
  }

  function sorted(folder: MutableFolder): VaultTreeNode[] {
    const folders = folder.children.filter(isFolder);
    const files = folder.children.filter(
      (child): child is { kind: "doc"; doc: VaultDoc } => !isFolder(child),
    );
    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return [...folders.map((f) => ({ ...f, children: sorted(f) }) as VaultTreeNode), ...files];
  }

  return sorted(root);
}

const TIMESTAMPED_STEM = /^(\d{4}-\d{2}-\d{2})-(\d{4}|\d{6})(?:-(.+))?$/;

/**
 * Splits a `note`/`handoff` filename stem (`YYYY-MM-DD-HHmm[ss][-title]`, see
 * `timestampedBasename`) into a human-readable date and the title slug, so
 * the tree can render the date dim (`TreeItem.description`) and the title as
 * the label. Falls back to the whole stem as the title when it doesn't
 * match the timestamped convention (e.g. plan filenames, which aren't
 * timestamped).
 */
export function splitTimestampedLabel(stem: string): { title: string; date?: string } {
  const match = TIMESTAMPED_STEM.exec(stem);
  if (!match) {
    return { title: stem };
  }
  const [, day, time, slug] = match as unknown as [string, string, string, string | undefined];
  const hh = time.slice(0, 2);
  const mm = time.slice(2, 4);
  const ss = time.length === 6 ? time.slice(4, 6) : undefined;
  const date = `${day} ${hh}:${mm}${ss ? `:${ss}` : ""}`;
  return slug ? { title: slug, date } : { title: date };
}
