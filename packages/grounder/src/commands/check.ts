/** Shared result shape for doctor (and similar) health checks. */

export type CheckLevel = "ok" | "fail" | "warn";

export interface CheckResult {
  id: string;
  level: CheckLevel;
  message: string;
  /** Actionable fix hint when level is not `"ok"`. */
  fix?: string;
}

export function okCheck(id: string, message: string): CheckResult {
  return { id, level: "ok", message };
}

export function failCheck(id: string, message: string, fix?: string): CheckResult {
  return {
    id,
    level: "fail",
    message,
    ...(fix !== undefined ? { fix } : {}),
  };
}

export function warnCheck(id: string, message: string, fix?: string): CheckResult {
  return {
    id,
    level: "warn",
    message,
    ...(fix !== undefined ? { fix } : {}),
  };
}
