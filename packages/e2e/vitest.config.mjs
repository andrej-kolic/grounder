import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.mjs"],
    // Each test spawns the real CLI several times (setup, migrate, ...) via
    // spawnSync — real process + file I/O, slower than the in-process
    // packages/grounder suite's default 5s budget.
    testTimeout: 30_000,
  },
});
