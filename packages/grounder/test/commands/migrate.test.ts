import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cursorHooksJsonPath, grounderNoteCommandPath } from "../../src/agents/cursor.js";
import { runMigrateWithOptions } from "../../src/commands/migrate.js";
import { runVaultInitWithOptions } from "../../src/commands/vault/init.js";
import { readGrounderState } from "../../src/connector/state.js";
import { fileExists } from "../../src/util/fs.js";
import { captureStdout, createTempEnv } from "../helpers.js";

describe("commands/migrate", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("requires home config", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const chunks: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      const code = await runMigrateWithOptions({ homeDir: env.home });
      expect(code).toBe(1);
      expect(chunks.join("")).toContain("grounder vault init <path>");
    } finally {
      spy.mockRestore();
    }
  });

  it("refreshes commands from the install ledger", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    const { code, out } = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));

    expect(code).toBe(0);
    expect(out).toContain(`Vault root: ${env.vault}`);
    expect(out).toContain("already current (skipped)");
    expect(await readGrounderState(env.home)).toMatchObject({
      agents: { cursor: { commandsSchema: 1 } },
    });
  });

  it("reports locally modified files and overwrites with --force", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    const noteDest = grounderNoteCommandPath(env.home);
    await writeFile(noteDest, "my local edits\n", "utf8");

    const skipped = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));
    expect(skipped.code).toBe(0);
    expect(skipped.out).toContain("locally modified (skipped — use --force)");
    expect(await readFile(noteDest, "utf8")).toBe("my local edits\n");

    const forced = await captureStdout(() =>
      runMigrateWithOptions({ homeDir: env.home, force: true }),
    );
    expect(forced.code).toBe(0);
    expect(forced.out).toContain(`updated: ${noteDest}`);
    expect(await readFile(noteDest, "utf8")).not.toBe("my local edits\n");
  });

  it("refreshes previously installed hooks without --hooks", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      hooks: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    const { code, out } = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));

    expect(code).toBe(0);
    expect(out).toMatch(/Cursor hook /);
    expect(await fileExists(cursorHooksJsonPath(env.home))).toBe(true);
  });

  it("does not install hooks that were never opted in", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    const { code, out } = await captureStdout(() => runMigrateWithOptions({ homeDir: env.home }));

    expect(code).toBe(0);
    expect(out).not.toMatch(/Cursor hook /);
    expect(await fileExists(cursorHooksJsonPath(env.home))).toBe(false);
  });

  it("dry-run previews without writing", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });
    const noteDest = grounderNoteCommandPath(env.home);
    await writeFile(noteDest, "my local edits\n", "utf8");
    const before = await readFile(noteDest, "utf8");

    const { code, out } = await captureStdout(() =>
      runMigrateWithOptions({ homeDir: env.home, force: true, dryRun: true }),
    );

    expect(code).toBe(0);
    expect(out).toContain("Dry run");
    expect(out).toContain("would update:");
    expect(await readFile(noteDest, "utf8")).toBe(before);
  });
});
