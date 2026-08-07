import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readGrounderState, recordAgentInstall, recordedFileHash } from "../connector/state.js";
import { VERSION } from "../index.js";
import { fileExists } from "../util/fs.js";
import { hashContent } from "../util/hash.js";
import { runtimeInvocation } from "./hook-runtime.js";
import type { AgentInstallOptions, ArtifactStatus } from "./types.js";

export interface InstallCommandFileOptions extends AgentInstallOptions {
  agentId: string;
  commandsSchema: number;
  templateDir: string;
  commandsDir: string;
  filename: string;
}

export interface InstallCommandFileResult {
  dest: string;
  status: ArtifactStatus;
  /** Present when content was (or would be) written — for ledger updates. */
  hash?: string;
}

/**
 * Install one slash-command markdown file with chezmoi-style drift detection.
 *
 * When the file already exists and `--force` is off:
 * - on-disk hash matches the ledger → safe to refresh to the new template
 * - no ledger hash, or on-disk hash differs → treat as user-edited (`modified`)
 */
export async function installCommandFile(
  opts: InstallCommandFileOptions,
): Promise<InstallCommandFileResult> {
  const dest = path.join(opts.commandsDir, opts.filename);
  const existed = await fileExists(dest);

  const template = await readFile(path.join(opts.templateDir, opts.filename), "utf8");
  const rendered = template.replaceAll("{{GROUNDER_CLI}}", runtimeInvocation(opts.homeDir));
  const renderedHash = hashContent(rendered);

  if (existed && !opts.force) {
    const onDisk = await readFile(dest, "utf8");
    const onDiskHash = hashContent(onDisk);
    const state = await readGrounderState(opts.homeDir);
    const recorded = recordedFileHash(state, opts.agentId, dest);

    if (recorded !== undefined && recorded === onDiskHash) {
      // Untouched since Grounder last wrote it — safe to auto-update.
      if (onDiskHash === renderedHash) {
        return { dest, status: "skipped", hash: renderedHash };
      }
      if (!opts.dryRun) {
        await writeFile(dest, rendered);
      }
      return { dest, status: "overwritten", hash: renderedHash };
    }

    // Legacy (no hash) or user-edited — protect content.
    return { dest, status: "modified" };
  }

  if (!opts.dryRun) {
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, rendered);
  }

  return {
    dest,
    status: existed ? "overwritten" : "created",
    hash: renderedHash,
  };
}

/**
 * Persist per-file hashes after a command install. No-op when `files` is empty
 * or `dryRun` is set.
 */
export async function recordCommandFileHashes(opts: {
  agentId: string;
  commandsSchema: number;
  files: Record<string, { schema: number; hash: string }>;
  homeDir?: string;
  dryRun?: boolean;
}): Promise<void> {
  if (opts.dryRun || Object.keys(opts.files).length === 0) {
    return;
  }
  await recordAgentInstall({
    agentId: opts.agentId,
    commandsSchema: opts.commandsSchema,
    files: opts.files,
    grounderVersion: VERSION,
    homeDir: opts.homeDir,
  });
}
