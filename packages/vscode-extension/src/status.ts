import { invokeCli } from "./cli.js";

export type ConfigState = "ok" | "missing" | "invalid" | "unsupported";

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

export interface StatusPayload {
  project: StatusProject;
}

const CONFIG_STATES = new Set<ConfigState>(["ok", "missing", "invalid", "unsupported"]);

function isConfigState(value: unknown): value is ConfigState {
  return typeof value === "string" && CONFIG_STATES.has(value as ConfigState);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * Parses `grounder status --json`'s stdout defensively — a CLI on an older
 * schema, or any unexpected shape, yields `null` rather than a crash.
 */
export function parseStatusJson(raw: string): StatusPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const project = (parsed as Record<string, unknown>).project;
  if (!project || typeof project !== "object") {
    return null;
  }
  const p = project as Record<string, unknown>;
  if (
    typeof p.linked !== "boolean" ||
    !isNullableString(p.folder) ||
    !isConfigState(p.configState) ||
    !isNullableString(p.projectId) ||
    !isNullableString(p.vaultRoot) ||
    !isNullableString(p.notesDir) ||
    !isNullableString(p.logsDir) ||
    !isNullableString(p.plansDir)
  ) {
    return null;
  }
  return {
    project: {
      linked: p.linked,
      folder: p.folder,
      configState: p.configState,
      projectId: p.projectId,
      vaultRoot: p.vaultRoot,
      notesDir: p.notesDir,
      logsDir: p.logsDir,
      plansDir: p.plansDir,
    },
  };
}

export type StatusResult =
  | { kind: "no-runtime" }
  | { kind: "error"; message: string }
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
  const payload = parseStatusJson(result.stdout);
  if (!payload) {
    return { kind: "error", message: "Could not parse `grounder status --json` output." };
  }
  return { kind: "ok", payload };
}
