import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { sandboxEnv } from "./sandbox.mjs";

const TIMEOUT_MS = 5 * 60 * 1000;
const MAX_BUFFER = 20 * 1024 * 1024;

function claudeArgs(model, prompt, addDir) {
  return [
    "-p",
    prompt,
    "--model",
    model,
    "--allowedTools",
    "Bash Read",
    "--add-dir",
    addDir,
    "--output-format",
    "stream-json",
    "--verbose",
  ];
}

function cursorAgentArgs(model, prompt, addDir, cwd) {
  return [
    "-p",
    prompt,
    "--model",
    model,
    "--force",
    "--workspace",
    cwd,
    "--add-dir",
    addDir,
    "--output-format",
    "stream-json",
  ];
}

export function parseNdjson(stdout) {
  const events = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Non-JSON noise (e.g. a stray log line) — ignore, not a probe event.
    }
  }
  return events;
}

/** Bash commands the model actually ran, and the final chat answer — from `claude`'s stream-json events. */
export function extractFromClaudeEvents(events) {
  const commands = [];
  let finalText = "";
  for (const event of events) {
    if (event.type === "assistant") {
      const blocks = event.message?.content;
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (
            block.type === "tool_use" &&
            block.name === "Bash" &&
            typeof block.input?.command === "string"
          ) {
            commands.push(block.input.command);
          }
        }
      }
    } else if (event.type === "result" && typeof event.result === "string") {
      finalText = event.result;
    }
  }
  return { commands, finalText };
}

/**
 * Same, from `cursor-agent`'s stream-json events (different tool-call shape).
 * Also collects each shell call's reported `workingDirectory` (the ground
 * truth for whether this probe actually stayed inside the sandbox, see
 * `runProbe`'s escape check) and every non-shell file mutation — writes
 * (`editToolCall`) and deletes (`deleteToolCall`), confirmed as the two
 * distinct event shapes by driving a real `cursor-agent -p` call for each.
 * Unlike `claude`, `cursor-agent` has no per-tool allowlist flag — a probe
 * could mutate a vault file via its Write/Edit/Delete tools instead of Bash
 * and never show up in `commands`, so callers that must never write (recall
 * probes) need this list too.
 */
export function extractFromCursorAgentEvents(events) {
  const commands = [];
  const workingDirs = [];
  const writes = [];
  let finalText = "";
  for (const event of events) {
    if (event.type === "tool_call" && event.subtype === "completed") {
      const shellArgs = event.tool_call?.shellToolCall?.args;
      if (typeof shellArgs?.command === "string") {
        commands.push(shellArgs.command);
        if (
          typeof shellArgs.workingDirectory === "string" &&
          shellArgs.workingDirectory.length > 0
        ) {
          workingDirs.push(shellArgs.workingDirectory);
        }
      }
      const editPath = event.tool_call?.editToolCall?.args?.path;
      if (typeof editPath === "string") {
        writes.push(editPath);
      }
      const deletePath = event.tool_call?.deleteToolCall?.args?.path;
      if (typeof deletePath === "string") {
        writes.push(deletePath);
      }
      // Not observed on the currently installed cursor-agent build — a live
      // create-a-new-file probe there goes through editToolCall too, and
      // grepping the installed binary for tool-call field names turns up no
      // `writeToolCall` — but the name is plausible for a future build, and
      // tracking it costs nothing.
      const writePath = event.tool_call?.writeToolCall?.args?.path;
      if (typeof writePath === "string") {
        writes.push(writePath);
      }
    } else if (event.type === "result" && typeof event.result === "string") {
      finalText = event.result;
    }
  }
  return { commands, finalText, workingDirs, writes };
}

/** `realpath`, falling back to the input unresolved if the path doesn't exist (or isn't readable). */
function tryRealpath(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Did any reported working directory land outside the sandbox `cwd`? Caught
 * this in the wild: a `cursor-agent` call once ran a search against the real
 * vault instead of the sandboxed one, with no explicit `cd` and no error —
 * only the resulting file paths gave it away. This check makes that failure
 * loud (an `error` result) instead of a silently-wrong grade.
 *
 * Compares `realpath`s, not raw strings: `cwd` is built from `os.tmpdir()`,
 * which on macOS is `/var/folders/...` — a symlink to `/private/var/folders/...`.
 * If `cursor-agent` reports the resolved form, a plain string comparison
 * would flag every legitimate in-sandbox call as an escape.
 */
export function findEscapedWorkingDir(workingDirs, cwd) {
  const realCwd = tryRealpath(cwd);
  return workingDirs.find((dir) => {
    const realDir = tryRealpath(dir);
    return realDir !== realCwd && !realDir.startsWith(`${realCwd}/`);
  });
}

/**
 * Runs one probe against a real headless agent CLI (`claude` or `cursor-agent`).
 * Ground truth, not self-report: commands come from the CLI's own tool-call
 * events, not anything the model is asked to disclose about itself.
 * @param modelEntry - one row of `DEFAULT_SWEEP` (`{ label, host, model }`).
 * @param prompt - the exact slash-command text a real user would type.
 * @param options.cwd - scratch project dir (must hold the sandboxed `.grounder.json`).
 * @param options.addDir - sandboxed vault dir to grant Read access to.
 * @param options.env - extra env vars for the child process (`GROUNDER_HOME`).
 * @returns `{ finalText, commands }` on success (`cursor-agent` runs also
 *   include `workingDirs` and `writes`), or `{ error }` on CLI failure or
 *   sandbox escape.
 */
export async function runProbe(modelEntry, prompt, { cwd, addDir, env }) {
  const { host, model } = modelEntry;
  const args =
    host === "claude"
      ? claudeArgs(model, prompt, addDir)
      : cursorAgentArgs(model, prompt, addDir, cwd);

  return new Promise((resolve) => {
    execFile(
      host,
      args,
      {
        cwd,
        env: sandboxEnv(env),
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
      },
      (error, stdout) => {
        // A timeout, non-zero exit, or signal means the turn never finished
        // cleanly — grade it as an error even if some NDJSON events made it
        // out before the cut, rather than judging a partial transcript as if
        // it were the model's finished answer.
        if (error) {
          const reason =
            error.killed || error.signal
              ? `CLI timed out or was killed (${error.signal ?? "SIGTERM"}).`
              : `CLI exited with error: ${error.message}`;
          resolve({ error: reason });
          return;
        }
        const events = parseNdjson(stdout ?? "");
        if (events.length === 0) {
          resolve({ error: "No output from CLI." });
          return;
        }
        const extracted =
          host === "claude"
            ? extractFromClaudeEvents(events)
            : extractFromCursorAgentEvents(events);

        if (extracted.workingDirs) {
          const escaped = findEscapedWorkingDir(extracted.workingDirs, cwd);
          if (escaped) {
            resolve({ error: `Sandbox escape: a shell call ran in "${escaped}", not "${cwd}".` });
            return;
          }
        }
        resolve(extracted);
      },
    );
  });
}
