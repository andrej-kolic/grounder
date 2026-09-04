import { describe, expect, it } from "vitest";
import {
  applyLedgerUpgrades,
  applyLedgerUpgradeTable,
  LEDGER_SCHEMA,
  type LedgerUpgradeTable,
  MIN_SUPPORTED_LEDGER_SCHEMA,
  REAL_LEDGER_UPGRADE_TABLE,
  upgradeFrom0,
} from "../../src/connector/ledger-migrations.js";

describe("connector/ledger-migrations", () => {
  describe("upgradeFrom0", () => {
    it("drops commandsSchema and folds hooksSchema into hooksEnabled", () => {
      const result = upgradeFrom0({
        grounderVersion: "0.5.0",
        agents: {
          cursor: {
            commandsSchema: 4,
            hooksSchema: 1,
            files: { "/a/SKILL.md": { hash: "sha256:aaa" } },
          },
          claude: { commandsSchema: 4, files: {} },
        },
      });

      expect(result).toEqual({
        grounderVersion: "0.5.0",
        agents: {
          cursor: { files: { "/a/SKILL.md": { hash: "sha256:aaa" } }, hooksEnabled: true },
          claude: { files: {} },
        },
      });
    });

    it("maps hooksSchema: 0 to hooksEnabled: undefined, not false", () => {
      // `false` means an explicit `--no-hooks` opt-out — a flag that didn't
      // exist in v0.5.0, so no v0.5.0 ledger value should ever produce it.
      // Folding `hooksSchema: 0` into `false` would turn a machine that
      // simply never installed hooks into a permanent sticky opt-out.
      const result = upgradeFrom0({
        grounderVersion: "0.6.0",
        agents: { cursor: { hooksSchema: 0, files: {} } },
      });

      expect("hooksEnabled" in (result.agents as Record<string, object>).cursor).toBe(false);
    });

    it("leaves hooksEnabled unset when neither key is present", () => {
      const result = upgradeFrom0({
        grounderVersion: "0.6.0",
        agents: { cursor: { files: {} } },
      });

      expect("hooksEnabled" in (result.agents as Record<string, object>).cursor).toBe(false);
    });
  });

  describe("applyLedgerUpgradeTable", () => {
    it("chains two or more steps in one call without touching production LEDGER_SCHEMA", () => {
      const table: LedgerUpgradeTable = {
        0: (raw) => ({ ...raw, a: 1 }),
        1: (raw) => ({ ...raw, b: 2 }),
      };

      const result = applyLedgerUpgradeTable({ seed: true }, 0, table, 2);
      expect(result).toEqual({ seed: true, a: 1, b: 2, ledgerSchema: 2 });
    });

    it("throws a clear invalid-state error on a missing table entry, not a bare TypeError", () => {
      expect(() => applyLedgerUpgradeTable({}, 0, {}, 1)).toThrow(
        /no ledger upgrade from schema 0/,
      );
    });

    it("wraps a throwing step into the same invalid-state error family", () => {
      const table: LedgerUpgradeTable = {
        0: () => {
          throw new Error("boom");
        },
      };
      expect(() => applyLedgerUpgradeTable({}, 0, table, 1)).toThrow(
        /ledger upgrade from schema 0 failed: boom/,
      );
    });

    it("is a no-op when from === target", () => {
      expect(applyLedgerUpgradeTable({ x: 1 }, 1, {}, 1)).toEqual({ x: 1 });
    });
  });

  describe("applyLedgerUpgrades", () => {
    it("upgrades a schema-0 raw object to the current schema via the real table", () => {
      const result = applyLedgerUpgrades(
        { grounderVersion: "0.6.0", agents: { cursor: { hooksSchema: 1, files: {} } } },
        0,
      );
      expect(result.ledgerSchema).toBe(LEDGER_SCHEMA);
    });
  });

  it("REAL_LEDGER_UPGRADE_TABLE has an entry for every version in [MIN_SUPPORTED, LEDGER_SCHEMA)", () => {
    for (let v = MIN_SUPPORTED_LEDGER_SCHEMA; v < LEDGER_SCHEMA; v++) {
      expect(REAL_LEDGER_UPGRADE_TABLE[v], `missing upgrade step from schema ${v}`).toBeTypeOf(
        "function",
      );
    }
  });
});
