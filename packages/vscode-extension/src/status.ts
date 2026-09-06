import { invokeCli } from "./cli.js";

export type ConfigState = "ok" | "missing" | "invalid" | "unsupported";
export type MachineConfigState = "ok" | "missing" | "invalid";
export type StateStatus = "ok" | "missing" | "invalid" | "unsupported";

/** Subset of `grounder status --json`'s `project` object this extension reads. */
export interface StatusProject {
  linked: boolean;
  folder: string | null;
  configState: ConfigState;
  projectId: string | null;
  vaultRoot: string | null;
  notesDir: string | null;
  logsDir: string | null;
  plansDir: string | null;
}

export interface StatusLedger {
  status: StateStatus;
  installCurrent: boolean | null;
  packageVersionNotice: string | null;
}

/** Subset of `grounder status --json`'s `machine` object this extension reads. */
export interface StatusMachine {
  configState: MachineConfigState;
  state: StatusLedger | null;
}

export interface StatusPayload {
  machine: StatusMachine;
  project: StatusProject;
}

/**
 * Bumped by the CLI (`packages/grounder/src/commands/status.ts`'s
 * `STATUS_JSON_SCHEMA_VERSION`) whenever `status --json`'s payload shape
 * changes. Compared directly in {@link parseStatusJson} instead of inferring
 * compatibility structurally from which fields happen to parse.
 */
export const CURRENT_SCHEMA_VERSION = 1;

const CONFIG_STATES = new Set<ConfigState>(["ok", "missing", "invalid", "unsupported"]);
const MACHINE_CONFIG_STATES = new Set<MachineConfigState>(["ok", "missing", "invalid"]);
const STATE_STATUSES = new Set<StateStatus>(["ok", "missing", "invalid", "unsupported"]);

function isConfigState(value: unknown): value is ConfigState {
  return typeof value === "string" && CONFIG_STATES.has(value as ConfigState);
}

function isMachineConfigState(value: unknown): value is MachineConfigState {
  return typeof value === "string" && MACHINE_CONFIG_STATES.has(value as MachineConfigState);
}

function isStateStatus(value: unknown): value is StateStatus {
  return typeof value === "string" && STATE_STATUSES.has(value as StateStatus);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * Reads `project` leniently: a field that's missing or the wrong type falls
 * back to a safe default instead of failing the whole parse, and flips
 * `complete` to `false` so the caller can tell a fully-trusted parse from a
 * best-effort one (see {@link parseStatusJson}'s `schemaVersion` handling).
 */
function parseProjectLenient(raw: unknown): { project: StatusProject; complete: boolean } {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const incomplete = { value: !(raw && typeof raw === "object") };

  const str = (value: unknown): string | null => {
    if (isNullableString(value)) return value;
    incomplete.value = true;
    return null;
  };
  const bool = (value: unknown): boolean => {
    if (typeof value === "boolean") return value;
    incomplete.value = true;
    return false;
  };
  const config = (value: unknown): ConfigState => {
    if (isConfigState(value)) return value;
    incomplete.value = true;
    return "missing";
  };

  return {
    project: {
      linked: bool(p.linked),
      folder: str(p.folder),
      configState: config(p.configState),
      projectId: str(p.projectId),
      vaultRoot: str(p.vaultRoot),
      notesDir: str(p.notesDir),
      logsDir: str(p.logsDir),
      plansDir: str(p.plansDir),
    },
    complete: !incomplete.value,
  };
}

/** Same leniency as {@link parseProjectLenient}, for the `machine` object. */
function parseMachineLenient(raw: unknown): { machine: StatusMachine; complete: boolean } {
  const m = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const incomplete = { value: !(raw && typeof raw === "object") };

  const machineConfig = (value: unknown): MachineConfigState => {
    if (isMachineConfigState(value)) return value;
    incomplete.value = true;
    return "missing";
  };
  const stateStatus = (value: unknown): StateStatus => {
    if (isStateStatus(value)) return value;
    incomplete.value = true;
    return "missing";
  };

  let state: StatusLedger | null = null;
  if (m.state && typeof m.state === "object") {
    const s = m.state as Record<string, unknown>;
    state = {
      status: stateStatus(s.status),
      installCurrent: typeof s.installCurrent === "boolean" ? s.installCurrent : null,
      packageVersionNotice: isNullableString(s.packageVersionNotice)
        ? s.packageVersionNotice
        : null,
    };
  } else if (m.state !== null) {
    incomplete.value = true;
  }

  return {
    machine: { configState: machineConfig(m.configState), state },
    complete: !incomplete.value,
  };
}

export type StatusParseResult =
  | { kind: "error" }
  | { kind: "newer-schema"; payload: StatusPayload }
  | { kind: "ok"; payload: StatusPayload };

/**
 * Parses `grounder status --json`'s stdout defensively.
 *
 * A CLI predating the `schemaVersion` field (older than this plan's CLI
 * change) is held to today's strict, all-or-nothing shape — any field
 * mismatch is `"error"`, same as before this extension read `machine.*` at
 * all. A CLI reporting a `schemaVersion` newer than {@link CURRENT_SCHEMA_VERSION}
 * whose shape has genuinely drifted returns `"newer-schema"` with whatever
 * top-level fields *did* parse, instead of failing outright.
 */
export function parseStatusJson(raw: string): StatusParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "error" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { kind: "error" };
  }
  const root = parsed as Record<string, unknown>;
  if (!root.project || typeof root.project !== "object") {
    return { kind: "error" };
  }

  const schemaVersion = typeof root.schemaVersion === "number" ? root.schemaVersion : undefined;
  const { project, complete: projectComplete } = parseProjectLenient(root.project);
  const { machine, complete: machineComplete } = parseMachineLenient(root.machine);
  const complete = projectComplete && machineComplete;

  if (complete) {
    return { kind: "ok", payload: { machine, project } };
  }
  if (schemaVersion !== undefined && schemaVersion > CURRENT_SCHEMA_VERSION) {
    return { kind: "newer-schema", payload: { machine, project } };
  }
  return { kind: "error" };
}

export type StatusResult =
  | { kind: "no-runtime" }
  | { kind: "error"; message: string }
  | { kind: "newer-schema"; payload: StatusPayload }
  | { kind: "ok"; payload: StatusPayload };

/** Runs `grounder status --json` at `cwd` and returns a typed, checked result. */
export async function fetchStatus(cwd: string): Promise<StatusResult> {
  const result = await invokeCli(["status", "--json"], { cwd });
  if (result.kind === "no-runtime") {
    return { kind: "no-runtime" };
  }
  if (result.kind === "error") {
    return {
      kind: "error",
      message: result.stderr.trim() || `grounder exited with code ${result.code}`,
    };
  }
  const parsed = parseStatusJson(result.stdout);
  if (parsed.kind === "error") {
    return { kind: "error", message: "Could not parse `grounder status --json` output." };
  }
  return parsed;
}
