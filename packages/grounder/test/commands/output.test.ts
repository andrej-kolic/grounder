import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  formatVaultItemListHeader,
  writeVaultItemList,
  writeVaultItemListEntries,
} from "../../src/commands/output.js";
import { captureStdout } from "../helpers.js";

const notes = { singular: "note", plural: "notes" } as const;

describe("formatVaultItemListHeader", () => {
  it("signals truncation when count equals limit", () => {
    expect(formatVaultItemListHeader(5, 5, notes)).toBe(
      "Most recent 5 notes (there may be more):\n\n",
    );
    expect(formatVaultItemListHeader(1, 1, notes)).toBe(
      "Most recent 1 note (there may be more):\n\n",
    );
  });

  it("reports a complete inventory when under the limit", () => {
    expect(formatVaultItemListHeader(2, 5, notes)).toBe("All 2 notes:\n\n");
    expect(formatVaultItemListHeader(1, 5, notes)).toBe("All 1 note:\n\n");
  });

  it("reports empty inventory with the plural noun", () => {
    expect(formatVaultItemListHeader(0, 5, notes)).toBe("No notes.\n");
    expect(formatVaultItemListHeader(0, 5, { singular: "handoff", plural: "handoffs" })).toBe(
      "No handoffs.\n",
    );
  });
});

describe("writeVaultItemList", () => {
  it("writes header plus numbered title/path blocks with Markdown hard breaks", async () => {
    const older = "/vault/logs/2026-06-26-1430.md";
    const newer = "/vault/logs/2026-06-26-1500-newer.md";

    const { out } = await captureStdout(async () => {
      writeVaultItemList([newer, older], 5, { singular: "handoff", plural: "handoffs" });
      return 0;
    });

    expect(out).toBe(
      `All 2 handoffs:\n\n1. 2026-06-26-1500-newer  \n  ${newer}\n\n2. 2026-06-26-1430  \n  ${older}\n`,
    );
  });

  it("writes markdown link title lines when markdown is set", async () => {
    const logsDir = "/vault/project/logs";
    const newer = `${logsDir}/2026-06-26-1500-newer.md`;
    const older = `${logsDir}/2026-06-26-1430.md`;

    const { out } = await captureStdout(async () => {
      writeVaultItemList(
        [newer, older],
        5,
        { singular: "handoff", plural: "handoffs" },
        {
          markdown: true,
          titleRootDir: logsDir,
        },
      );
      return 0;
    });

    expect(out).toBe(
      `All 2 handoffs:\n\n` +
        `1. [2026-06-26-1500-newer.md](${pathToFileURL(newer).href})  \n  ${newer}\n\n` +
        `2. [2026-06-26-1430.md](${pathToFileURL(older).href})  \n  ${older}\n`,
    );
  });

  it("keeps nested bucket-relative markdown titles without the bucket prefix", async () => {
    const logsDir = "/vault/project/logs";
    const nested = `${logsDir}/feature/2026-06-26-1600.md`;

    const { out } = await captureStdout(async () => {
      writeVaultItemListEntries([nested], { markdown: true, titleRootDir: logsDir });
      return 0;
    });

    expect(out).toBe(
      `1. [feature/2026-06-26-1600.md](${pathToFileURL(nested).href})  \n  ${nested}\n`,
    );
  });

  it("uses bucket-relative plain titles when titleRootDir is set", async () => {
    const logsDir = "/vault/project/logs";
    const nested = `${logsDir}/feature/2026-06-26-1600.md`;
    const root = `${logsDir}/2026-06-26-1500.md`;

    const { out } = await captureStdout(async () => {
      writeVaultItemList(
        [nested, root],
        5,
        { singular: "handoff", plural: "handoffs" },
        { titleRootDir: logsDir },
      );
      return 0;
    });

    expect(out).toBe(
      `All 2 handoffs:\n\n1. feature/2026-06-26-1600  \n  ${nested}\n\n2. 2026-06-26-1500  \n  ${root}\n`,
    );
  });

  it("writes only the empty notice when there are no paths", async () => {
    const { out } = await captureStdout(async () => {
      writeVaultItemList([], 5, notes);
      return 0;
    });
    expect(out).toBe("No notes.\n");
  });
});

describe("writeVaultItemListEntries", () => {
  it("separates items with a blank line", async () => {
    const { out } = await captureStdout(async () => {
      writeVaultItemListEntries(["/a/first.md", "/a/second.md"]);
      return 0;
    });
    expect(out).toBe("1. first  \n  /a/first.md\n\n2. second  \n  /a/second.md\n");
  });
});
