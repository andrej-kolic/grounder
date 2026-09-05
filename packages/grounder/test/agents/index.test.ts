import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ALL_AGENTS, cursor, ownedLedgerFiles, resolveAgents } from "../../src/agents/index.js";
import { createTempEnv } from "../helpers.js";

describe("agents/index - resolveAgents", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let prevHome: string | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
    // Restore GROUNDER_HOME
    if (prevHome === undefined) delete process.env.GROUNDER_HOME;
    else process.env.GROUNDER_HOME = prevHome;
  });

  it("lists every known agent in ALL_AGENTS", () => {
    expect(ALL_AGENTS.map((a) => a.id).sort()).toEqual(["claude", "cursor"]);
  });

  it("returns explicitly requested adapters by id", async () => {
    const agents = await resolveAgents(["cursor"]);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("cursor");
  });

  it("throws on unknown agent id", async () => {
    await expect(resolveAgents(["windsurf"])).rejects.toThrow("Unknown agent id(s): windsurf");
  });

  it("auto-detects: returns empty when no agents installed", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    prevHome = process.env.GROUNDER_HOME;
    process.env.GROUNDER_HOME = env.home;

    const agents = await resolveAgents();
    expect(agents).toHaveLength(0);
  });

  it("auto-detects: returns the one agent whose dir exists", async () => {
    const env = await createTempEnv({ initGit: false });
    cleanup = env.cleanup;

    await mkdir(path.join(env.home, ".cursor"), { recursive: true });

    prevHome = process.env.GROUNDER_HOME;
    process.env.GROUNDER_HOME = env.home;

    const agents = await resolveAgents();
    expect(agents.map((a) => a.id)).toEqual(["cursor"]);
  });
});

describe("agents/index - ownedLedgerFiles", () => {
  it("passes through undefined for an agent with no ledger entry at all", () => {
    expect(ownedLedgerFiles(cursor, undefined, "/home/user")).toBeUndefined();
  });

  it("keeps entries under the adapter's owned prefixes (skills dir, legacy commands dir)", () => {
    const files = {
      "/home/user/.cursor/skills/grounder-note/SKILL.md": { hash: "sha256:a" },
      "/home/user/.cursor/commands/grounder-note.md": { hash: "sha256:b" },
    };
    expect(ownedLedgerFiles(cursor, files, "/home/user")).toEqual(files);
  });

  it("drops a stray entry outside every owned prefix — a hand-edited or corrupted state.json", () => {
    const files = {
      "/home/user/.cursor/skills/grounder-note/SKILL.md": { hash: "sha256:a" },
      "/etc/passwd": { hash: "sha256:evil" },
    };
    expect(ownedLedgerFiles(cursor, files, "/home/user")).toEqual({
      "/home/user/.cursor/skills/grounder-note/SKILL.md": { hash: "sha256:a" },
    });
  });
});
