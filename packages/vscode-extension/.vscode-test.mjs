import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@vscode/test-cli";

// VS Code's user-data-dir hosts a unix socket whose path must stay under the
// OS limit (~103 chars on macOS) — the repo's own path (especially inside a
// worktree) is too long for that, so route it through the OS temp dir instead.
const userDataDir = mkdtempSync(path.join(os.tmpdir(), "grounder-vscode-test-"));

export default defineConfig({
  label: "integration",
  files: "out/test-integration/**/*.test.js",
  workspaceFolder: "test-integration/fixtures/empty-workspace",
  launchArgs: [`--user-data-dir=${userDataDir}`],
  mocha: {
    timeout: 20_000,
  },
});
