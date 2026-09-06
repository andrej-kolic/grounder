import { describe, expect, it } from "vitest";
import { resolveFolderState } from "../src/folderState.js";
import type { StatusPayload, StatusResult } from "../src/status.js";

function healthyPayload(
  overrides: {
    machine?: Partial<StatusPayload["machine"]>;
    project?: Partial<StatusPayload["project"]>;
  } = {},
): StatusPayload {
  return {
    machine: {
      configState: "ok",
      state: { status: "ok", installCurrent: true, packageVersionNotice: null },
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
  };
}

function ok(overrides?: Parameters<typeof healthyPayload>[0]): StatusResult {
  return { kind: "ok", payload: healthyPayload(overrides) };
}

describe("resolveFolderState", () => {
  // Matrix row #1: never installed, never linked anywhere.
  it("no-runtime + no .grounder.json marker -> no-runtime-unlinked", () => {
    expect(resolveFolderState({ kind: "no-runtime" }, false)).toEqual({
      kind: "no-runtime-unlinked",
    });
  });

  // Matrix row #2: linked here, but setup/migrate never run on this machine.
  it("no-runtime + .grounder.json marker present -> no-runtime-linked", () => {
    expect(resolveFolderState({ kind: "no-runtime" }, true)).toEqual({
      kind: "no-runtime-linked",
    });
  });

  // Matrix row #9.
  it("CLI process/spawn error -> cli-error", () => {
    const status: StatusResult = { kind: "error", message: "boom" };
    expect(resolveFolderState(status, false)).toEqual({ kind: "cli-error", message: "boom" });
  });

  // Matrix row #10 (surfaced by fetchStatus as kind: "error" already).
  it("unparseable JSON reaches folderState as a cli-error", () => {
    const status: StatusResult = {
      kind: "error",
      message: "Could not parse `grounder status --json` output.",
    };
    expect(resolveFolderState(status, false).kind).toBe("cli-error");
  });

  it("newer, incompatible schema -> newer-schema", () => {
    const status: StatusResult = { kind: "newer-schema", payload: healthyPayload() };
    expect(resolveFolderState(status, false)).toEqual({ kind: "newer-schema" });
  });

  // Matrix row #6: home config missing/invalid.
  it("machine.configState missing -> machine-config-broken", () => {
    const status = ok({ machine: { configState: "missing" } });
    expect(resolveFolderState(status, false)).toEqual({
      kind: "machine-config-broken",
      configState: "missing",
    });
  });

  it("machine.configState invalid -> machine-config-broken", () => {
    const status = ok({ machine: { configState: "invalid" } });
    expect(resolveFolderState(status, false)).toEqual({
      kind: "machine-config-broken",
      configState: "invalid",
    });
  });

  // Matrix row #11: ledger missing.
  it("machine.state null -> ledger-missing", () => {
    const status = ok({ machine: { state: null } });
    expect(resolveFolderState(status, false)).toEqual({ kind: "ledger-missing" });
  });

  it("machine.state.status 'missing' -> ledger-missing", () => {
    const status = ok({
      machine: { state: { status: "missing", installCurrent: null, packageVersionNotice: null } },
    });
    expect(resolveFolderState(status, false)).toEqual({ kind: "ledger-missing" });
  });

  // Matrix row #12: ledger corrupt.
  it("machine.state.status 'invalid' -> ledger-broken", () => {
    const status = ok({
      machine: { state: { status: "invalid", installCurrent: null, packageVersionNotice: null } },
    });
    expect(resolveFolderState(status, false)).toEqual({ kind: "ledger-broken", status: "invalid" });
  });

  // Matrix row #13: ledger schema newer than this CLI supports.
  it("machine.state.status 'unsupported' -> ledger-broken", () => {
    const status = ok({
      machine: {
        state: { status: "unsupported", installCurrent: null, packageVersionNotice: null },
      },
    });
    expect(resolveFolderState(status, false)).toEqual({
      kind: "ledger-broken",
      status: "unsupported",
    });
  });

  // Matrix row #3.
  it("project not linked -> unlinked", () => {
    const status = ok({ project: { linked: false, folder: null, configState: "missing" } });
    expect(resolveFolderState(status, false)).toEqual({ kind: "unlinked" });
  });

  // Matrix row #5: fixed remedy — distinct from generic invalid/missing.
  it("project.configState 'unsupported' -> project-schema-unsupported", () => {
    const status = ok({ project: { configState: "unsupported" } });
    expect(resolveFolderState(status, false)).toEqual({ kind: "project-schema-unsupported" });
  });

  // Matrix row #4.
  it("project.configState 'invalid' -> project-config-broken", () => {
    const status = ok({ project: { configState: "invalid" } });
    expect(resolveFolderState(status, false)).toEqual({
      kind: "project-config-broken",
      configState: "invalid",
    });
  });

  // Matrix row #6 root-cause obviated: dirs null despite configState ok is now unreachable via
  // machine, but kept as a defensive fallback.
  it("dirs null despite project.configState ok -> dirs-missing", () => {
    const status = ok({ project: { notesDir: null, logsDir: null, plansDir: null } });
    expect(resolveFolderState(status, false)).toEqual({ kind: "dirs-missing" });
  });

  // Matrix row #8: ancestor link renders transparently, by design.
  it("fully healthy, ancestor-linked project -> healthy, no drift", () => {
    const status = ok();
    const result = resolveFolderState(status, false);
    expect(result.kind).toBe("healthy");
    if (result.kind !== "healthy") throw new Error("expected healthy");
    expect(result.installDrift).toBe(false);
  });

  // Matrix row #14: non-blocking notice, not a replacement of the tree.
  it("installCurrent false -> healthy with installDrift true", () => {
    const status = ok({
      machine: { state: { status: "ok", installCurrent: false, packageVersionNotice: null } },
    });
    const result = resolveFolderState(status, false);
    expect(result.kind).toBe("healthy");
    if (result.kind !== "healthy") throw new Error("expected healthy");
    expect(result.installDrift).toBe(true);
  });

  // Matrix row #15: non-blocking notice, surfaced alongside (not instead of) the real tree.
  it("packageVersionNotice set -> healthy with the notice text", () => {
    const status = ok({
      machine: {
        state: {
          status: "ok",
          installCurrent: true,
          packageVersionNotice:
            "Grounder 1.4.0 is installed, but your configuration is still from 1.3.0",
        },
      },
    });
    const result = resolveFolderState(status, false);
    expect(result.kind).toBe("healthy");
    if (result.kind !== "healthy") throw new Error("expected healthy");
    expect(result.packageVersionNotice).toBe(
      "Grounder 1.4.0 is installed, but your configuration is still from 1.3.0",
    );
  });

  // Priority ordering: a broken ledger outranks a pending migrate notice, since drift is
  // meaningless if the ledger itself can't be trusted.
  it("unsupported ledger wins over install drift when both would apply", () => {
    const status = ok({
      machine: {
        state: { status: "unsupported", installCurrent: false, packageVersionNotice: null },
      },
    });
    expect(resolveFolderState(status, false)).toEqual({
      kind: "ledger-broken",
      status: "unsupported",
    });
  });

  // Priority ordering: a broken machine config outranks everything project-specific.
  it("machine config broken wins over project not linked", () => {
    const status = ok({
      machine: { configState: "invalid" },
      project: { linked: false, folder: null, configState: "missing" },
    });
    expect(resolveFolderState(status, false)).toEqual({
      kind: "machine-config-broken",
      configState: "invalid",
    });
  });

  // Priority ordering: an unsupported project schema outranks the generic invalid/missing case.
  it("project schema unsupported wins over the generic broken-config fallback wording", () => {
    const status = ok({ project: { configState: "unsupported", notesDir: null } });
    expect(resolveFolderState(status, false)).toEqual({ kind: "project-schema-unsupported" });
  });
});
