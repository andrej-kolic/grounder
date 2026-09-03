import { describe, expect, it } from "vitest";
import type { AgentAdapter } from "../../src/agents/types.js";
import {
  plural,
  type Row,
  renderModifiedNote,
  renderSummary,
  renderTable,
  rowFromPlanEntry,
  rowsFromApplyResult,
  toRowStatus,
} from "../../src/commands/render-artifact-table.js";
import { captureSyncStdout as captureStdout } from "../helpers.js";

describe("commands/render-artifact-table", () => {
  describe("toRowStatus", () => {
    it("maps every ArtifactStatus to a RowStatus", () => {
      expect(toRowStatus("skipped")).toBe("current");
      expect(toRowStatus("created")).toBe("create");
      expect(toRowStatus("overwritten")).toBe("update");
      expect(toRowStatus("modified")).toBe("modified");
    });
  });

  describe("rowFromPlanEntry", () => {
    it("maps every PlanAction to a RowStatus, carrying blockedAction as forceAction", () => {
      expect(rowFromPlanEntry("cursor", { path: "/a", action: "noop" })).toEqual({
        status: "current",
        target: "cursor",
        path: "/a",
        forceAction: undefined,
      });
      expect(rowFromPlanEntry("cursor", { path: "/a", action: "forget" })).toMatchObject({
        status: "current",
      });
      expect(rowFromPlanEntry("cursor", { path: "/a", action: "create" })).toMatchObject({
        status: "create",
      });
      expect(rowFromPlanEntry("cursor", { path: "/a", action: "update" })).toMatchObject({
        status: "update",
      });
      expect(rowFromPlanEntry("cursor", { path: "/a", action: "delete" })).toMatchObject({
        status: "delete",
      });
      expect(
        rowFromPlanEntry("cursor", { path: "/a", action: "conflict", blockedAction: "delete" }),
      ).toEqual({ status: "modified", target: "cursor", path: "/a", forceAction: "delete" });
    });
  });

  describe("rowsFromApplyResult", () => {
    it("labels runtime, whole-file, and hook rows distinctly, hooks suffixed with ' hook'", () => {
      const agent = { id: "cursor" } as AgentAdapter;
      const rows = rowsFromApplyResult({
        runtime: { cliPath: "/runtime", status: "created", mode: "symlink" },
        agents: [
          {
            agent,
            plan: [{ path: "/note.md", action: "create" }],
            hooks: { artifacts: { "/hooks.json": "modified" } },
            ledgerChanged: true,
          },
        ],
      });

      expect(rows).toEqual([
        { status: "create", target: "runtime", path: "/runtime" },
        { status: "create", target: "cursor", path: "/note.md", forceAction: undefined },
        {
          status: "modified",
          target: "cursor hook",
          path: "/hooks.json",
          forceAction: "overwrite",
        },
      ]);
    });
  });

  describe("plural", () => {
    it("pluralizes only when the count isn't 1", () => {
      expect(plural(1, "file")).toBe("1 file");
      expect(plural(0, "file")).toBe("0 files");
      expect(plural(2, "file")).toBe("2 files");
    });
  });

  describe("renderTable", () => {
    it("renders a header and one row per entry, columns aligned to the widest cell", () => {
      const rows: Row[] = [
        { status: "create", target: "cursor", path: "/a" },
        { status: "modified", target: "cursor hook", path: "/b" },
      ];
      const out = captureStdout(() => renderTable(rows));
      const lines = out.split("\n").filter(Boolean);
      expect(lines[0]).toBe("STATUS   TARGET      PATH");
      expect(lines[1]).toBe("created  cursor      /a");
      expect(lines[2]).toBe("conflict cursor hook /b");
    });
  });

  describe("renderSummary", () => {
    it("reports nothing to do when every row is current", () => {
      const rows: Row[] = [{ status: "current", target: "cursor", path: "/a" }];
      const out = captureStdout(() => renderSummary(rows, false));
      expect(out).toBe("Nothing to do — 1 file unchanged.\n");
    });

    it("reports nothing to do for an empty row set", () => {
      const out = captureStdout(() => renderSummary([], false));
      expect(out).toBe("Nothing to do.\n");
    });

    it("real run: joins acted counts and trailers into one capitalized sentence", () => {
      const rows: Row[] = [
        { status: "create", target: "cursor", path: "/a" },
        { status: "update", target: "cursor", path: "/b" },
        { status: "current", target: "cursor", path: "/c" },
      ];
      const out = captureStdout(() => renderSummary(rows, false));
      expect(out).toBe("Created 1, updated 1, 1 file unchanged.\n");
    });

    it("dry run: uses infinitive verbs and points at --dry-run when there's real work", () => {
      const rows: Row[] = [
        { status: "create", target: "cursor", path: "/a" },
        { status: "delete", target: "cursor", path: "/b" },
      ];
      const out = captureStdout(() => renderSummary(rows, true));
      expect(out).toBe("Would create 1, delete 1. Run without --dry-run to apply.\n");
    });

    it("real run: a conflict-only result is never reported as nothing to do", () => {
      const rows: Row[] = [{ status: "modified", target: "cursor", path: "/a" }];
      const out = captureStdout(() => renderSummary(rows, false));
      expect(out).not.toContain("Nothing to do");
      expect(out).toBe("1 file left as a conflict.\n");
    });

    it("dry run: mixed create + conflict still points at --dry-run, and mentions the conflict", () => {
      const rows: Row[] = [
        { status: "create", target: "cursor", path: "/a" },
        { status: "modified", target: "cursor", path: "/b" },
      ];
      const out = captureStdout(() => renderSummary(rows, true));
      expect(out).toBe(
        "Would create 1, 1 file left as a conflict. Run without --dry-run to apply.\n",
      );
    });

    it("dry run: a conflict-only result points at --force, not --dry-run", () => {
      const rows: Row[] = [
        { status: "modified", target: "cursor", path: "/a" },
        { status: "modified", target: "cursor", path: "/b" },
      ];
      const out = captureStdout(() => renderSummary(rows, true));
      expect(out).not.toContain("Nothing to do");
      // Re-running without --dry-run would still write nothing here — only
      // --force resolves a conflict — so the dry-run closer must not tell the
      // reader to drop --dry-run.
      expect(out).not.toContain("Run without --dry-run to apply");
      expect(out).toBe(
        "Nothing to write, 2 files left as conflicts. Run with --force to resolve.\n",
      );
    });
  });

  describe("renderModifiedNote", () => {
    it("prints nothing when there are no conflicts", () => {
      const rows: Row[] = [{ status: "current", target: "cursor", path: "/a" }];
      const out = captureStdout(() => renderModifiedNote(rows, "grounder migrate"));
      expect(out).toBe("");
    });

    it("singular overwrite conflict", () => {
      const rows: Row[] = [
        { status: "modified", target: "cursor", path: "/a", forceAction: "overwrite" },
      ];
      const out = captureStdout(() => renderModifiedNote(rows, "grounder migrate"));
      expect(out).toContain("1 file left alone — Grounder can't confirm it's unedited:");
      expect(out).toContain("/a (would be overwritten)");
      expect(out).toContain(
        "Run 'grounder migrate --force' to overwrite it (any local edits are lost).",
      );
    });

    it("mixed overwrite/delete conflicts use plural wording and both verbs", () => {
      const rows: Row[] = [
        { status: "modified", target: "cursor", path: "/a", forceAction: "overwrite" },
        { status: "modified", target: "cursor", path: "/b", forceAction: "delete" },
      ];
      const out = captureStdout(() => renderModifiedNote(rows, "grounder migrate"));
      expect(out).toContain("2 files left alone — Grounder can't confirm they're unedited:");
      expect(out).toContain("/a (would be overwritten)");
      expect(out).toContain("/b (would be deleted)");
      expect(out).toContain(
        "Run 'grounder migrate --force' to overwrite or delete them (any local edits are lost).",
      );
    });
  });
});
