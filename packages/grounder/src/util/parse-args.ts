export interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | boolean>;
  /** Raw repeated flag values, e.g. --agent=cursor --agent=claude → ["cursor","claude"] */
  repeated: Map<string, string[]>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  const repeated = new Map<string, string[]>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags.set(key, next);
        const arr = repeated.get(key) ?? [];
        arr.push(next);
        repeated.set(key, arr);
        i++;
      } else {
        flags.set(key, true);
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      for (const char of arg.slice(1)) {
        flags.set(char, true);
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags, repeated };
}

export function flagBool(flags: Map<string, string | boolean>, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = flags.get(key);
    if (value === true || value === "true") {
      return true;
    }
  }
  return false;
}

export function flagString(
  flags: Map<string, string | boolean>,
  key: string,
): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

/** Collect all values from a repeated flag, e.g. --agent cursor --agent claude → ["cursor","claude"]. */
export function flagStrings(repeated: Map<string, string[]>, key: string): string[] {
  return repeated.get(key) ?? [];
}
