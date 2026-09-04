import { describe, expect, it } from "vitest";
import {
  desiredDrift,
  isUnderOwnedPrefix,
  planChangesLedger,
  reconcile,
} from "../../src/reconcile/core.js";

describe("reconcile/core", () => {
  describe("isUnderOwnedPrefix", () => {
    it("matches a path nested under a prefix", () => {
      expect(isUnderOwnedPrefix("/a/b/c.md", ["/a/b"])).toBe(true);
    });

    it("matches the prefix path itself", () => {
      expect(isUnderOwnedPrefix("/a/b", ["/a/b"])).toBe(true);
    });

    it("rejects a sibling directory that merely shares the prefix as a substring", () => {
      // "/a/bee" starts with "/a/b" as a raw string but is not under it.
      expect(isUnderOwnedPrefix("/a/bee/c.md", ["/a/b"])).toBe(false);
    });

    it("rejects a path under none of the given prefixes", () => {
      expect(isUnderOwnedPrefix("/etc/passwd", ["/a/b", "/a/c"])).toBe(false);
    });
  });

  describe("desiredDrift", () => {
    it("returns no drift for an agent absent from the ledger — even with skill files missing on disk", () => {
      // Fifth-pass gap 1: `ledger === undefined` must short-circuit to no
      // drift, not compute a per-path diff — otherwise a detected-but-never-
      // set-up agent nags `migrate` forever with nothing able to silence it.
      const drift = desiredDrift(
        { "/a/SKILL.md": "sha256:aaa", "/b/SKILL.md": "sha256:bbb" },
        undefined,
      );
      expect(drift).toEqual([]);
    });

    it("reports a desired path missing from a recorded agent's files map as create-drift", () => {
      // Second half of gap 1: within a ledger-recorded agent, a *newly added*
      // desired path still surfaces — this is how a sixth skill file would
      // show up in peek.
      const drift = desiredDrift(
        { "/a/SKILL.md": "sha256:aaa", "/new/SKILL.md": "sha256:zzz" },
        { "/a/SKILL.md": { hash: "sha256:aaa" } },
      );
      expect(drift).toEqual([{ path: "/new/SKILL.md", kind: "create" }]);
    });

    it("reports a hash mismatch as update-drift", () => {
      const drift = desiredDrift(
        { "/a/SKILL.md": "sha256:new" },
        { "/a/SKILL.md": { hash: "sha256:old" } },
      );
      expect(drift).toEqual([{ path: "/a/SKILL.md", kind: "update" }]);
    });

    it("reports nothing when every desired path matches the ledger", () => {
      const drift = desiredDrift(
        { "/a/SKILL.md": "sha256:aaa" },
        { "/a/SKILL.md": { hash: "sha256:aaa" } },
      );
      expect(drift).toEqual([]);
    });
  });

  describe("reconcile", () => {
    it("fresh install: every desired path missing on disk plans as create", () => {
      const plan = reconcile({ "/a/SKILL.md": "sha256:aaa" }, [], undefined, {}, false);
      expect(plan).toEqual([{ path: "/a/SKILL.md", action: "create" }]);
    });

    it("no-op: on-disk content already matches desired, regardless of ledger", () => {
      const plan = reconcile(
        { "/a/SKILL.md": "sha256:aaa" },
        [],
        undefined,
        { "/a/SKILL.md": "sha256:aaa" },
        false,
      );
      expect(plan).toEqual([{ path: "/a/SKILL.md", action: "noop" }]);
    });

    it("safe auto-update: on-disk differs from desired, but matches the ledger's last-applied hash", () => {
      const plan = reconcile(
        { "/a/SKILL.md": "sha256:new" },
        [],
        { "/a/SKILL.md": { hash: "sha256:old" } },
        { "/a/SKILL.md": "sha256:old" },
        false,
      );
      expect(plan).toEqual([{ path: "/a/SKILL.md", action: "update" }]);
    });

    it("user-modified conflict: on-disk differs from desired and from the ledger (or no ledger entry)", () => {
      const withLedgerMismatch = reconcile(
        { "/a/SKILL.md": "sha256:new" },
        [],
        { "/a/SKILL.md": { hash: "sha256:old" } },
        { "/a/SKILL.md": "sha256:user-edited" },
        false,
      );
      expect(withLedgerMismatch).toEqual([
        { path: "/a/SKILL.md", action: "conflict", blockedAction: "overwrite" },
      ]);

      const withNoLedgerEntry = reconcile(
        { "/a/SKILL.md": "sha256:new" },
        [],
        undefined,
        { "/a/SKILL.md": "sha256:pre-existing" },
        false,
      );
      expect(withNoLedgerEntry).toEqual([
        { path: "/a/SKILL.md", action: "conflict", blockedAction: "overwrite" },
      ]);
    });

    it("--force overwrites a conflict unconditionally", () => {
      const plan = reconcile(
        { "/a/SKILL.md": "sha256:new" },
        [],
        undefined,
        { "/a/SKILL.md": "sha256:user-edited" },
        true,
      );
      expect(plan).toEqual([{ path: "/a/SKILL.md", action: "update" }]);
    });

    it("retirement via manifest diff: a ledger-recorded path dropped from the current desired set", () => {
      const plan = reconcile(
        {},
        [],
        { "/old/SKILL.md": { hash: "sha256:aaa" } },
        { "/old/SKILL.md": "sha256:aaa" },
        false,
      );
      expect(plan).toEqual([{ path: "/old/SKILL.md", action: "delete" }]);
    });

    it("retirement via a tombstoned path with no ledger entry at all", () => {
      // Gap 1's actual bug case: a pre-hash-tracking install never recorded
      // this path, so a pure ledger-manifest diff is blind to it — the
      // tombstone list is what makes it visible.
      const plan = reconcile(
        {},
        ["/legacy/note.md"],
        undefined,
        { "/legacy/note.md": "sha256:whatever-was-there" },
        false,
      );
      expect(plan).toEqual([
        { path: "/legacy/note.md", action: "conflict", blockedAction: "delete" },
      ]);

      const forced = reconcile(
        {},
        ["/legacy/note.md"],
        undefined,
        { "/legacy/note.md": "sha256:whatever-was-there" },
        true,
      );
      expect(forced).toEqual([{ path: "/legacy/note.md", action: "delete" }]);
    });

    it("a tombstoned path whose file is already gone resolves to noop, not a recurring delete", () => {
      const plan = reconcile({}, ["/legacy/note.md"], undefined, {}, false);
      expect(plan).toEqual([{ path: "/legacy/note.md", action: "noop" }]);
    });

    it("a tombstoned path already gone, but with a stale ledger hash, resolves to forget", () => {
      const plan = reconcile(
        {},
        ["/legacy/note.md"],
        { "/legacy/note.md": { hash: "sha256:stale" } },
        {},
        false,
      );
      expect(plan).toEqual([{ path: "/legacy/note.md", action: "forget" }]);
    });

    it("the unknown-agent diff guard is the caller's responsibility, not reconcile's", () => {
      // reconcile() itself has no concept of "known agent" — it trusts
      // whatever `desired` it's given. The safety boundary (never compute a
      // diff for an unrecognized ledger agent id) lives in the caller
      // (resolveMigrateAgents / the agents this binary iterates), not here.
      // This test documents that reconcile is agent-agnostic by design.
      const plan = reconcile({}, [], { "/anything": { hash: "sha256:x" } }, {}, false);
      expect(plan).toEqual([{ path: "/anything", action: "forget" }]);
    });
  });

  describe("planChangesLedger", () => {
    it("an all-noop plan on a machine whose ledger is otherwise current reports no ledger change", () => {
      const plan = reconcile(
        { "/a/SKILL.md": "sha256:aaa" },
        [],
        { "/a/SKILL.md": { hash: "sha256:aaa" } },
        { "/a/SKILL.md": "sha256:aaa" },
        false,
      );
      expect(
        planChangesLedger(
          plan,
          { "/a/SKILL.md": { hash: "sha256:aaa" } },
          {
            "/a/SKILL.md": "sha256:aaa",
          },
        ),
      ).toBe(false);
    });

    it("an update whose new hash already matches the ledger changes nothing (force-restore case)", () => {
      // A file was force-overwritten back to content the ledger already had
      // recorded (e.g. `--force` restoring a locally-edited file to the
      // exact template it already tracked) — the file action is "update",
      // but the ledger write itself is a no-op.
      const plan = [{ path: "/a/SKILL.md", action: "update" as const }];
      expect(
        planChangesLedger(
          plan,
          { "/a/SKILL.md": { hash: "sha256:aaa" } },
          {
            "/a/SKILL.md": "sha256:aaa",
          },
        ),
      ).toBe(false);
    });

    it("create/update/noop change the ledger only when the recorded hash actually differs", () => {
      expect(
        planChangesLedger([{ path: "/a/SKILL.md", action: "create" }], undefined, {
          "/a/SKILL.md": "sha256:aaa",
        }),
      ).toBe(true);
      expect(
        planChangesLedger(
          [{ path: "/a/SKILL.md", action: "noop" }],
          { "/a/SKILL.md": { hash: "sha256:stale" } },
          { "/a/SKILL.md": "sha256:aaa" },
        ),
      ).toBe(true);
    });

    it("delete changes the ledger only when an entry exists to forget", () => {
      expect(
        planChangesLedger(
          [{ path: "/legacy.md", action: "delete" }],
          { "/legacy.md": { hash: "sha256:x" } },
          {},
        ),
      ).toBe(true);
      expect(planChangesLedger([{ path: "/legacy.md", action: "delete" }], undefined, {})).toBe(
        false,
      );
    });

    it("forget always changes the ledger, conflict never does", () => {
      expect(planChangesLedger([{ path: "/legacy.md", action: "forget" }], undefined, {})).toBe(
        true,
      );
      expect(
        planChangesLedger(
          [{ path: "/a/SKILL.md", action: "conflict", blockedAction: "overwrite" }],
          undefined,
          {},
        ),
      ).toBe(false);
    });
  });
});
