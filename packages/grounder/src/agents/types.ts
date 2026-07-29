export type ArtifactStatus = "created" | "skipped" | "overwritten";

export interface AgentInstallOptions {
  force?: boolean;
  homeDir?: string;
}

export interface AgentInstallResult {
  /** Map of installed file path → what happened to it. */
  artifacts: Record<string, ArtifactStatus>;
}

export interface AgentAdapter {
  /** Stable lowercase id used in config and flags, e.g. "cursor". */
  readonly id: string;
  /** Human-readable display name, e.g. "Cursor". */
  readonly name: string;
  /** Returns true when this agent appears to be installed on the machine. */
  isInstalled(): Promise<boolean>;
  /** Absolute paths of artifacts this adapter installs (read-only inspect). */
  expectedArtifacts(homeDir?: string): string[];
  /** Install all agent-specific artifacts (commands, rules, etc.). */
  install(opts: AgentInstallOptions): Promise<AgentInstallResult>;
  /** Optional: install session hooks (separate from slash-command install). */
  installHooks?(opts: AgentInstallOptions): Promise<AgentInstallResult>;
  /** Optional: absolute path(s) of hook config this adapter would touch. */
  expectedHookArtifacts?(homeDir?: string): string[];
}
