import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, parseStatusJson } from "../src/status.js";

function fullPayload(
  overrides: {
    machine?: Partial<Record<string, unknown>>;
    project?: Partial<Record<string, unknown>>;
    schemaVersion?: unknown;
  } = {},
): string {
  return JSON.stringify({
    schemaVersion: overrides.schemaVersion ?? CURRENT_SCHEMA_VERSION,
    machine: {
      configPath: "/home/.grounder/config.json",
      configState: "ok",
      vaultRoot: "/vault",
      state: {
        path: "/home/.grounder/state.json",
        status: "ok",
        packageVersionNotice: null,
        installCurrent: true,
      },
      ...overrides.machine,
    },
    project: {
      linked: true,
      folder: "/repo",
      configState: "ok",
      projectId: "my-app",
      vaultRoot: "/vault/my-app",
      notesDir: "/vault/my-app/notes",
      logsDir: "/vault/my-app/logs",
      plansDir: "/vault/my-app/plans",
      ...overrides.project,
    },
  });
}

describe("parseStatusJson", () => {
  it("parses a fully linked, fully healthy payload", () => {
    const result = parseStatusJson(fullPayload());
    expect(result).toEqual({
      kind: "ok",
      payload: {
        machine: {
          configState: "ok",
          state: { status: "ok", installCurrent: true, packageVersionNotice: null },
        },
        project: {
          linked: true,
          folder: "/repo",
          configState: "ok",
          projectId: "my-app",
          vaultRoot: "/vault/my-app",
          notesDir: "/vault/my-app/notes",
          logsDir: "/vault/my-app/logs",
          plansDir: "/vault/my-app/plans",
        },
      },
    });
  });

  it("parses an unlinked project with a missing machine ledger", () => {
    const result = parseStatusJson(
      fullPayload({
        machine: { configState: "missing", vaultRoot: null, state: null },
        project: {
          linked: false,
          folder: null,
          configState: "missing",
          projectId: null,
          vaultRoot: null,
          notesDir: null,
          logsDir: null,
          plansDir: null,
        },
      }),
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.payload.machine).toEqual({ configState: "missing", state: null });
    expect(result.payload.project.linked).toBe(false);
    expect(result.payload.project.notesDir).toBeNull();
  });

  it("parses an unsupported ledger status", () => {
    const result = parseStatusJson(
      fullPayload({
        machine: {
          state: {
            path: "/home/.grounder/state.json",
            status: "unsupported",
            packageVersionNotice: null,
            installCurrent: null,
          },
        },
      }),
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.payload.machine.state?.status).toBe("unsupported");
  });

  it("returns an error for invalid JSON", () => {
    expect(parseStatusJson("not json")).toEqual({ kind: "error" });
  });

  it("returns an error when the project field is missing", () => {
    expect(parseStatusJson(JSON.stringify({ machine: {} }))).toEqual({ kind: "error" });
  });

  it("returns an error when a known field has the wrong type and there's no schemaVersion to explain it", () => {
    const raw = JSON.stringify({
      // no schemaVersion at all — pre-dates the field, held to strict parsing
      machine: { configState: "ok", vaultRoot: null, state: null },
      project: {
        linked: "yes", // wrong type
        folder: null,
        configState: "missing",
        projectId: null,
        vaultRoot: null,
        notesDir: null,
        logsDir: null,
        plansDir: null,
      },
    });
    expect(parseStatusJson(raw)).toEqual({ kind: "error" });
  });

  it("returns an error when configState isn't one of the known values and schemaVersion is current", () => {
    const result = parseStatusJson(fullPayload({ project: { configState: "surprising" } }));
    expect(result).toEqual({ kind: "error" });
  });

  it("falls back to newer-schema with partial data when schemaVersion is ahead and shape drifted", () => {
    const raw = fullPayload({
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      project: { configState: "surprising" }, // simulates a renamed/incompatible field
    });
    const result = parseStatusJson(raw);
    expect(result.kind).toBe("newer-schema");
    if (result.kind !== "newer-schema") throw new Error("expected newer-schema");
    // Whatever did parse is still available — linked/folder came through fine.
    expect(result.payload.project.linked).toBe(true);
    expect(result.payload.project.folder).toBe("/repo");
  });

  it("does not flag newer-schema when the higher version's shape still parses cleanly", () => {
    const result = parseStatusJson(fullPayload({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 }));
    expect(result.kind).toBe("ok");
  });
});
