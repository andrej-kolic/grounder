import { describe, expect, it } from "vitest";
import { parseStatusJson } from "../src/status.js";

function payload(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    project: {
      linked: true,
      folder: "/repo",
      configState: "ok",
      projectId: "my-app",
      vaultRoot: "/vault/my-app",
      notesDir: "/vault/my-app/notes",
      logsDir: "/vault/my-app/logs",
      plansDir: "/vault/my-app/plans",
      ...overrides,
    },
  });
}

describe("parseStatusJson", () => {
  it("parses a fully linked project", () => {
    const result = parseStatusJson(payload());
    expect(result).toEqual({
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
    });
  });

  it("parses an unlinked project (null fields)", () => {
    const result = parseStatusJson(
      JSON.stringify({
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
    expect(result?.project.linked).toBe(false);
    expect(result?.project.notesDir).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseStatusJson("not json")).toBeNull();
  });

  it("returns null when the project field is missing", () => {
    expect(parseStatusJson(JSON.stringify({ machine: {} }))).toBeNull();
  });

  it("returns null when configState isn't one of the known values", () => {
    expect(parseStatusJson(payload({ configState: "surprising" }))).toBeNull();
  });

  it("returns null when a required field has the wrong type", () => {
    expect(parseStatusJson(payload({ linked: "yes" }))).toBeNull();
  });
});
