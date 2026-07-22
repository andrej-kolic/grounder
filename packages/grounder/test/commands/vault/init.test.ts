import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runVaultInitWithOptions } from "../../../src/commands/vault/init.js";
import { homeConfigPath } from "../../../src/connector/home.js";
import {
  grounderNoteCommandPath,
  grounderTaskHandoffCommandPath,
} from "../../../src/agents/cursor.js";
import { createTempEnv } from "../../helpers.js";

describe("commands/vault/init", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  it("creates home config, vault scaffold, and cursor commands", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    const code = await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    expect(code).toBe(0);
    expect(JSON.parse(await readFile(homeConfigPath(env.home), "utf8"))).toEqual({
      vaultRoot: env.vault,
    });
    await access(path.join(env.vault, "10-Projects"));
    expect(await readFile(grounderNoteCommandPath(env.home), "utf8")).toContain("npx grounder note");
    expect(await readFile(grounderNoteCommandPath(env.home), "utf8")).toContain(
      "approve shell permissions",
    );
    expect(await readFile(grounderTaskHandoffCommandPath(env.home), "utf8")).toContain(
      "npx grounder handoff",
    );
  });

  it("is idempotent on re-run", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home, agents: ["cursor"] });
    const noteBefore = await readFile(grounderNoteCommandPath(env.home), "utf8");
    const handoffBefore = await readFile(grounderTaskHandoffCommandPath(env.home), "utf8");

    const code = await runVaultInitWithOptions({
      vaultPath: env.vault,
      yes: true,
      homeDir: env.home,
      agents: ["cursor"],
    });

    expect(code).toBe(0);
    expect(await readFile(grounderNoteCommandPath(env.home), "utf8")).toBe(noteBefore);
    expect(await readFile(grounderTaskHandoffCommandPath(env.home), "utf8")).toBe(handoffBefore);
  });

  it("returns error before prompting when vault already configured to a different path", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    // First init succeeds
    await runVaultInitWithOptions({ vaultPath: env.vault, yes: true, homeDir: env.home, agents: [] });

    // Re-init with a different vault path and no --force should fail immediately (exit 1)
    // without hanging on a confirmation prompt (yes: false but no TTY needed since it errors first)
    const code = await runVaultInitWithOptions({
      vaultPath: env.vault + "-other",
      yes: false,
      homeDir: env.home,
      agents: [],
    });

    expect(code).toBe(1);
  });
});
