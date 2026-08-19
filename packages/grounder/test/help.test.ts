import { describe, expect, it, vi } from "vitest";
import {
  COMMANDS,
  DISPATCHED_COMMAND_IDS,
  printCommandHelp,
  printFullHelp,
  printSynopsis,
  resolveCommandHelp,
  runHelp,
  wantsHelp,
} from "../src/help.js";

describe("help", () => {
  it("detects exact -h / --help tokens only", () => {
    expect(wantsHelp(["--help"])).toBe(true);
    expect(wantsHelp(["-h"])).toBe(true);
    expect(wantsHelp(["foo", "--help"])).toBe(true);
    expect(wantsHelp(["-yh"])).toBe(false);
    expect(wantsHelp(["--force"])).toBe(false);
  });

  it("resolves nested topics with longest match", () => {
    expect(resolveCommandHelp(["handoff", "list"])?.id).toBe("handoff list");
    expect(resolveCommandHelp(["plan", "list"])?.id).toBe("plan list");
    expect(resolveCommandHelp(["note", "list"])?.id).toBe("note list");
    expect(resolveCommandHelp(["handoff"])?.id).toBe("handoff");
    expect(resolveCommandHelp(["vault"])).toBeUndefined();
    expect(resolveCommandHelp(["setup"])?.id).toBe("setup");
    expect(resolveCommandHelp(["path", "plans"])?.id).toBe("path plans");
    expect(resolveCommandHelp(["nope"])).toBeUndefined();
  });

  it("COMMANDS and DISPATCHED_COMMAND_IDS stay in sync", () => {
    const metaIds = new Set(COMMANDS.map((c) => c.id));
    const dispatched = new Set<string>(DISPATCHED_COMMAND_IDS);

    for (const id of DISPATCHED_COMMAND_IDS) {
      expect(metaIds.has(id), `missing COMMANDS entry for dispatched id "${id}"`).toBe(true);
    }
    for (const id of metaIds) {
      expect(
        dispatched.has(id),
        `orphan COMMANDS entry "${id}" not in DISPATCHED_COMMAND_IDS`,
      ).toBe(true);
    }
  });

  it("runHelp prints full help or per-command help", () => {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      expect(runHelp([])).toBe(0);
      const full = chunks.join("");
      expect(full).toContain("Commands:");
      expect(full).toContain("Setup\n");
      expect(full).toContain("Write\n");
      expect(full).toContain("--dry-run");

      chunks.length = 0;
      expect(runHelp(["migrate"])).toBe(0);
      expect(chunks.join("")).toContain("Usage: grounder migrate");
      expect(chunks.join("")).toContain("--dry-run");

      chunks.length = 0;
      expect(runHelp(["setup"])).toBe(0);
      expect(chunks.join("")).toContain("Usage: grounder setup");
    } finally {
      spy.mockRestore();
    }
  });

  it("synopsis and full help share the markdown-native banner", () => {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      printSynopsis();
      const synopsis = chunks.join("");
      expect(synopsis).toContain("grounder — markdown-native memory for AI agents");
      expect(synopsis).not.toContain("connect git projects");
      expect(synopsis).not.toContain("Obsidian");

      chunks.length = 0;
      printFullHelp();
      const full = chunks.join("");
      expect(full).toContain("grounder — markdown-native memory for AI agents");
      expect(full).not.toContain("connect git projects");
      expect(full).not.toContain("Obsidian");
    } finally {
      spy.mockRestore();
    }
  });

  it("printCommandHelp includes usage, summary, and flags", () => {
    const meta = resolveCommandHelp(["plan"]);
    expect(meta).toBeDefined();
    if (!meta) {
      return;
    }
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      printCommandHelp(meta);
      const out = chunks.join("");
      expect(out).toContain("Usage: grounder plan");
      expect(out).toContain("--force");
      expect(out).toContain("--path");
      expect(out).toContain("named plan");
    } finally {
      spy.mockRestore();
    }
  });
});
