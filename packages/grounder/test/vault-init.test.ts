import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { homeConfigPath } from "../src/config.js";
import { grounderNoteCommandPath } from "../src/cursor/install-command.js";
import { runVaultInitWithOptions } from "../src/commands/vault-init.js";
import { createTempEnv } from "./helpers.js";

describe("vault init", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("creates home config, vault scaffold, and cursor command", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const code = await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
    });

    expect(code).toBe(0);
    expect(JSON.parse(await readFile(homeConfigPath(), "utf8"))).toEqual({
      vaultRoot: env.vault,
    });
    await access(path.join(env.vault, "10-Projects"));
    expect(await readFile(grounderNoteCommandPath(env.home), "utf8")).toContain("grounder note");
  });

  it("is idempotent on re-run", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home });
    const commandBefore = await readFile(grounderNoteCommandPath(env.home), "utf8");

    const code = await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
    });

    expect(code).toBe(0);
    expect(await readFile(grounderNoteCommandPath(env.home), "utf8")).toBe(commandBefore);
  });
});
