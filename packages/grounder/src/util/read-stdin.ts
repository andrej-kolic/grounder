import type { Readable } from "node:stream";

/**
 * Read all of `stdin` as a UTF-8 string, giving up after `timeoutMs`.
 *
 * Returns `undefined` for TTY stdin (no piped input) or when nothing ever
 * arrives. If data arrived but stdin has not ended by the timeout, the
 * buffered payload so far is still returned — callers piping JSON that gets
 * flushed before the pipe closes (e.g. editor hook payloads) must not lose it.
 * Never throws.
 */
export function readStdinWithTimeout(
  stdin: NodeJS.ReadableStream,
  timeoutMs: number,
): Promise<string | undefined> {
  if ("isTTY" in stdin && stdin.isTTY) {
    return Promise.resolve(undefined);
  }

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
