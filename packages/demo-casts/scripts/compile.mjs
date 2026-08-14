/**
 * Dependency-free asciicast v2 compiler.
 * No PTY, no live shell — scene steps are hand-authored / mocked.
 *
 * @typedef {{ type: "type"; text: string; cps?: number }} TypeStep
 * @typedef {{ type: "output"; text: string }} OutputStep
 * @typedef {{ type: "wait"; seconds: number }} WaitStep
 * @typedef {TypeStep | OutputStep | WaitStep} Step
 *
 * @typedef {object} CompileOptions
 * @property {number} [width]
 * @property {number} [height]
 * @property {number} [cps] Default chars-per-second for `type` steps
 * @property {number} [timestamp] Header timestamp (fixed for determinism)
 * @property {Record<string, string>} [env]
 */

const DEFAULT_CPS = 22;
const OUTPUT_DT = 0.02;

/**
 * Expand scene steps into timed output fragments (`dt` relative, not absolute).
 * @param {Step[]} steps
 * @param {number} defaultCps
 * @returns {{ dt: number; data: string }[]}
 */
export function expandSteps(steps, defaultCps = DEFAULT_CPS) {
  /** @type {{ dt: number; data: string }[]} */
  const events = [];

  for (const step of steps) {
    switch (step.type) {
      case "type": {
        const cps = step.cps ?? defaultCps;
        if (!(cps > 0)) {
          throw new Error(`type step cps must be > 0, got ${cps}`);
        }
        const perChar = 1 / cps;
        for (const ch of step.text) {
          events.push({ dt: perChar, data: ch });
        }
        break;
      }
      case "output":
        events.push({ dt: OUTPUT_DT, data: step.text });
        break;
      case "wait": {
        if (!(step.seconds >= 0)) {
          throw new Error(`wait seconds must be >= 0, got ${step.seconds}`);
        }
        events.push({ dt: step.seconds, data: "" });
        break;
      }
      default: {
        const bad = /** @type {{ type?: string }} */ (step);
        throw new Error(`unknown step type: ${bad?.type ?? typeof step}`);
      }
    }
  }

  return events;
}

/**
 * Compile scene steps to asciicast v2 JSONL (header + timed `[t, "o", data]` events).
 * Deterministic for the same steps + options (fixed timestamp, fixed cps).
 *
 * @param {Step[]} steps
 * @param {CompileOptions} [options]
 * @returns {string} JSONL including trailing newline
 */
export function compileCast(steps, options = {}) {
  if (!Array.isArray(steps)) {
    throw new Error("steps must be an array");
  }

  const width = options.width ?? 80;
  const height = options.height ?? 14;
  const cps = options.cps ?? DEFAULT_CPS;
  const timestamp = options.timestamp ?? 0;
  const env = options.env ?? { SHELL: "/bin/zsh", TERM: "xterm-256color" };

  const header = {
    version: 2,
    width,
    height,
    timestamp,
    env,
  };

  let t = 0;
  let lastEmittedT = 0;
  const lines = [JSON.stringify(header)];

  for (const ev of expandSteps(steps, cps)) {
    t += ev.dt;
    if (ev.data === "") continue;
    lastEmittedT = t;
    lines.push(JSON.stringify([Number(t.toFixed(3)), "o", ev.data]));
  }

  // Trailing waits advance `t` but emit no bytes — record a no-op event so
  // cast duration (and players/agg that key off the last timestamp) include them.
  if (t > lastEmittedT) {
    lines.push(JSON.stringify([Number(t.toFixed(3)), "o", ""]));
  }

  return `${lines.join("\n")}\n`;
}
