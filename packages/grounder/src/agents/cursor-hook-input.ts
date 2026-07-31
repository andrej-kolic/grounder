import type { Readable } from "node:stream";

/** Max wait for piped Cursor hook JSON on stdin before giving up. */
const STDIN_TIMEOUT_MS = 200;

/**
 * Read Cursor's sessionStart hook payload from stdin and return the first
 * workspace root when present.
 *
 * Cursor pipes JSON like `{ "workspace_roots": ["/path/to/repo"] }` into
 * user-level hooks, whose `cwd` is `~/.cursor` — not the open project.
 *
 * Never throws. Returns `undefined` for TTY stdin, empty/malformed input,
 * missing `workspace_roots`, or when no data arrives within the timeout
 * (so interactive/`grounder handoff peek` runs never hang). If data arrived
 * but stdin has not ended yet, the buffered payload is still parsed.
 */
export async function readCursorHookWorkspaceRoot(
  stdin: NodeJS.ReadableStream = process.stdin,
): Promise<string | undefined> {
  if ("isTTY" in stdin && stdin.isTTY) {
    return undefined;
  }

  const raw = await readStdinWithTimeout(stdin, STDIN_TIMEOUT_MS);
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const roots = (parsed as Record<string, unknown>).workspace_roots;
    if (!Array.isArray(roots) || roots.length === 0) {
      return undefined;
    }
    const first = roots[0];
    if (typeof first !== "string" || first.trim() === "") {
      return undefined;
    }
    return first;
  } catch {
    return undefined;
  }
}

function readStdinWithTimeout(
  stdin: NodeJS.ReadableStream,
  timeoutMs: number,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let settled = false;

    const settle = (value: string | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      stdin.off("error", onError);
      resolve(value);
    };

    const onData = (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    };
    const buffered = (): string | undefined => {
      if (chunks.length === 0) {
        return undefined;
      }
      return Buffer.concat(chunks).toString("utf8");
    };

    const onEnd = () => settle(buffered());
    const onError = () => settle(undefined);

    // On timeout, still use whatever arrived — Cursor may flush the JSON
    // payload before closing stdin; discarding it would lose workspace_roots.
    const timer = setTimeout(() => settle(buffered()), timeoutMs);
    timer.unref?.();

    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.on("error", onError);

    if ("readableEnded" in stdin && (stdin as Readable).readableEnded) {
      onEnd();
    }
  });
}
