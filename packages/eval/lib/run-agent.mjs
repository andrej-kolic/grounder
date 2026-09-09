import { execFile } from "node:child_process";

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

function parseNdjson(stdout) {
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
function extractFromClaudeEvents(events) {
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
 * Also collects each shell call's reported `workingDirectory` — the ground
 * truth for whether this probe actually stayed inside the sandbox (see
 * `runProbe`'s escape check).
 */
function extractFromCursorAgentEvents(events) {
  const commands = [];
  const workingDirs = [];
  let finalText = "";
  for (const event of events) {
    if (event.type === "tool_call" && event.subtype === "completed") {
      const args = event.tool_call?.shellToolCall?.args;
      if (typeof args?.command === "string") {
        commands.push(args.command);
        if (typeof args.workingDirectory === "string" && args.workingDirectory.length > 0) {
          workingDirs.push(args.workingDirectory);
        }
      }
    } else if (event.type === "result" && typeof event.result === "string") {
      finalText = event.result;
    }
  }
  return { commands, finalText, workingDirs };
}

/**
 * Did any reported working directory land outside the sandbox `cwd`? Caught
 * this in the wild: a `cursor-agent` call once ran a search against the real
 * vault instead of the sandboxed one, with no explicit `cd` and no error —
 * only the resulting file paths gave it away. This check makes that failure
 * loud (an `error` result) instead of a silently-wrong grade.
 */
function findEscapedWorkingDir(workingDirs, cwd) {
  return workingDirs.find((dir) => dir !== cwd && !dir.startsWith(`${cwd}/`));
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
 * @returns `{ finalText, commands }` on success, or `{ error }` on CLI failure
 *   or sandbox escape.
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
        env: { ...process.env, ...env },
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
      },
      (error, stdout) => {
        const events = parseNdjson(stdout ?? "");
        if (events.length === 0) {
          resolve({ error: error ? error.message : "No output from CLI." });
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
