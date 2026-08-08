/**
 * On-disk schema/version is newer than this binary understands (git-style hard
 * stop). Distinct from corrupt data — fix is upgrade grounder, not reinit.
 */
export class UnsupportedSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedSchemaError";
  }
}

export function isUnsupportedSchemaError(error: unknown): error is UnsupportedSchemaError {
  return error instanceof UnsupportedSchemaError;
}
