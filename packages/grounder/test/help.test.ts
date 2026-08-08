import { describe, expect, it, vi } from "vitest";
import {
  COMMANDS,
  DISPATCHED_COMMAND_IDS,
  printCommandHelp,
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
    expect(resolveCommandHelp(["handoff"])?.id).toBe("handoff");
    expect(resolveCommandHelp(["vault"])?.id).toBe("vault");
    expect(resolveCommandHelp(["vault", "init"])?.id).toBe("vault init");
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
      expect(runHelp(["vault"])).toBe(0);
      expect(chunks.join("")).toContain("Usage: grounder vault init");
      expect(chunks.join("")).toContain("Subcommands:");
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
