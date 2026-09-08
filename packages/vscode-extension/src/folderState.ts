import type {
  ConfigState,
  MachineConfigState,
  StateStatus,
  StatusProject,
  StatusResult,
} from "./status.js";

export type FolderState =
  | { kind: "no-runtime-unlinked" }
  | { kind: "no-runtime-linked" }
  | { kind: "cli-error"; message: string }
  | { kind: "newer-schema" }
  | { kind: "machine-config-broken"; configState: Exclude<MachineConfigState, "ok"> }
  | { kind: "ledger-missing" }
  | { kind: "ledger-broken"; status: Exclude<StateStatus, "ok" | "missing"> }
  | { kind: "unlinked" }
  | { kind: "project-schema-unsupported" }
  | { kind: "project-config-broken"; configState: Exclude<ConfigState, "ok" | "unsupported"> }
  | { kind: "dirs-missing" }
  | {
      kind: "healthy";
      project: LinkedProject;
      installDrift: boolean;
      packageVersionNotice: string | null;
    };

/** `StatusProject` once linked and fully configured — vault dirs are guaranteed non-null. */
export type LinkedProject = StatusProject & { notesDir: string; logsDir: string; plansDir: string };

/**
 * The extension's one explicit, ordered check list over everything
 * `grounder status --json` can report (plus the pre-JSON failure modes),
 * replacing the old ad hoc `project.*`-only if/else chain. First match wins.
 *
 * Pure and VS Code-API-free by design, so every row of the plan's edge-case
 * matrix can be asserted directly against a constructed {@link StatusResult}
 * (see `test/folderState.test.ts`) without spinning up the extension host.
 *
 * `hasGrounderMarker` is consulted only in the `no-runtime` case — it's the
 * one signal that distinguishes "never installed, never linked" from
 * "linked, but `setup`/`migrate` was never run here" when there's no runtime
 * to ask `status --json` in the first place.
 */
export function resolveFolderState(status: StatusResult, hasGrounderMarker: boolean): FolderState {
  if (status.kind === "no-runtime") {
    return hasGrounderMarker ? { kind: "no-runtime-linked" } : { kind: "no-runtime-unlinked" };
  }
  if (status.kind === "error") {
    return { kind: "cli-error", message: status.message };
  }
  if (status.kind === "newer-schema") {
    return { kind: "newer-schema" };
  }

  const { machine, project } = status.payload;

  if (machine.configState !== "ok") {
    return { kind: "machine-config-broken", configState: machine.configState };
  }
  if (!machine.state) {
    return { kind: "ledger-missing" };
  }
  if (machine.state.status !== "ok") {
    if (machine.state.status === "missing") {
      return { kind: "ledger-missing" };
    }
    return { kind: "ledger-broken", status: machine.state.status };
  }
  const installDrift = machine.state.installCurrent === false;
  const packageVersionNotice = machine.state.packageVersionNotice;

  if (!project.linked) {
    return { kind: "unlinked" };
  }
  if (project.configState === "unsupported") {
    return { kind: "project-schema-unsupported" };
  }
  if (project.configState !== "ok") {
    return { kind: "project-config-broken", configState: project.configState };
  }
  if (!project.notesDir || !project.logsDir || !project.plansDir) {
    return { kind: "dirs-missing" };
  }
  const linked: LinkedProject = {
    ...project,
    notesDir: project.notesDir,
    logsDir: project.logsDir,
    plansDir: project.plansDir,
  };
  return { kind: "healthy", project: linked, installDrift, packageVersionNotice };
}
