import { createHash } from "node:crypto";

/** SHA-256 of UTF-8 content, prefixed `sha256:` for ledger storage. */
export function hashContent(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}
