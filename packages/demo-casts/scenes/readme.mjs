/**
 * README hero: the typical-session examples table, typed in table order.
 * Entirely fabricated — no shell, no real vault paths, no real CLI execution.
 *
 * Story: hook teaser → resume latest saved session → save a living plan →
 * search a topic → write a note from an instruction → save a session summary.
 * Names and paths match README How it works (auth-rewrite / auth-middleware).
 *
 * Color legend (kept to ANSI 16-color + bold — no glyphs agg's font
 * might not have):
 *   cyan        `[grounder]` system/hook tag
 *   magenta "> "  agent chat prompt (vs. a plain shell `$`)
 *   bold        text the "user" types
 *   green       vault paths grounder actually wrote/found (the "this is real" signal)
 */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const bold = (s) => `${BOLD}${s}${RESET}`;
const cyan = (s) => `\x1b[36m${s}${RESET}`;
const magenta = (s) => `\x1b[35m${s}${RESET}`;
const green = (s) => `\x1b[32m${s}${RESET}`;

const THINK = 0.3;

function prompt() {
  return { type: "output", text: `${magenta(">")} ` };
}

/** Bold "typed" text (user input), then a plain newline. */
function say(text) {
  return [
    { type: "output", text: BOLD },
    { type: "type", text },
    { type: "output", text: `${RESET}\r\n` },
    { type: "wait", seconds: THINK },
  ];
}

export default {
  width: 88,
  height: 22,
  cps: 32,
  steps: [
    // Session-start hook teaser — fires unprompted, before any input.
    {
      type: "output",
      text: `${cyan("[grounder]")} Latest handoff: "auth-middleware" (2026-08-14). Run /grounder-task to load it, or ignore if unrelated.\r\n\r\n`,
    },
    { type: "wait", seconds: 1.3 },

    // Resume the latest saved session.
    prompt(),
    ...say("/grounder-task"),
    {
      type: "output",
      text:
        "Reading logs/2026-08-14-103000-auth-middleware.md\r\n" +
        "Done: mapped current middleware order.\r\n" +
        `${bold("Next:")} 1. Add tests for the 401 path\r\n\r\n`,
    },
    { type: "wait", seconds: 1.6 },

    // Turn this session into a living plan.
    prompt(),
    ...say("/grounder-plan save insights from this session as an implementation plan with steps"),
    {
      type: "output",
      text: `${green("Wrote ~/vault/10-Projects/your-project/plans/auth-rewrite.md")}\r\n\r\n`,
    },
    { type: "wait", seconds: 1.6 },

    // Search a topic — note + plan is enough to show it ranks across buckets.
    prompt(),
    ...say("/grounder-search decisions and discussions on token refresh"),
    {
      type: "output",
      text:
        `${green("Found ~/vault/10-Projects/your-project/notes/2026-07-21-auth-investigation.md")}\r\n` +
        `${green("Found ~/vault/10-Projects/your-project/plans/auth-rewrite.md")}\r\n\r\n`,
    },
    { type: "wait", seconds: 2.0 },
    prompt(),
    ...say("/grounder-note explain why we rejected cookie sessions"),
    {
      type: "output",
      text: `${green("Wrote ~/vault/10-Projects/your-project/notes/2026-08-14-rejected-cookie-sessions.md")}\r\n\r\n`,
    },
    { type: "wait", seconds: 1.6 },

    // Save a short session summary.
    prompt(),
    ...say("/grounder-task-handoff"),
    {
      type: "output",
      text: `${green("Wrote ~/vault/10-Projects/your-project/logs/2026-08-14-173000-auth-middleware.md")}\r\n\r\n`,
    },
    { type: "wait", seconds: 1.4 },

    // Hold on the final prompt so README GIF viewers can finish reading
    // before the loop restarts. Keep in sync with agg --last-frame-duration.
    prompt(),
    { type: "wait", seconds: 3 },
  ],
};
