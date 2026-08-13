/**
 * README hero: a full session-loop walkthrough, not just one command.
 * Entirely fabricated — no shell, no real vault paths, no real CLI execution.
 *
 * Story: a session resumes via the peek hook + /grounder-task, checks what
 * plans exist (proving it's real vault data, not a canned string), picks one
 * back up, drops a quick note mid-session, then hands off on close.
 *
 * Color legend (kept to ANSI 16-color + bold/dim — no glyphs agg's font
 * might not have):
 *   cyan        `[grounder]` system/hook tag
 *   magenta "> "  agent chat prompt (vs. a plain shell `$`)
 *   bold        text the "user" types
 *   dim "- ..."   the real grounder CLI call a slash command runs under the hood
 *   green       vault paths grounder actually wrote/found (the "this is real" signal)
 */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const bold = (s) => `${BOLD}${s}${RESET}`;
const dim = (s) => `\x1b[2m${s}${RESET}`;
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

/** Dim trace line for the real CLI call a slash command runs under the hood. */
function trace(cmd) {
  return { type: "output", text: `${dim(`- ${cmd}`)}\r\n` };
}

export default {
  width: 88,
  height: 22,
  cps: 32,
  steps: [
    // Session-start hook teaser — fires unprompted, before any input.
    {
      type: "output",
      text: `${cyan("[grounder]")} Latest handoff: "checkout flow redesign" (2026-08-10). Run /grounder-task to load it, or ignore if unrelated.\r\n\r\n`,
    },
    { type: "wait", seconds: 1.3 },

    // Resume prior work.
    prompt(),
    ...say("/grounder-task"),
    trace("grounder handoff list --head"),
    {
      type: "output",
      text:
        "Reading logs/2026-08-10-1615-checkout-flow-redesign.md\r\n" +
        "Done: extracted shipping-address form into its own component.\r\n" +
        `${bold("Next:")} 1. Wire coupon-code validation\r\n` +
        "Picking up coupon-code validation now.\r\n\r\n",
    },
    { type: "wait", seconds: 1.6 },

    // List plans — proves this is real, connected vault data.
    prompt(),
    ...say("/grounder-plan list"),
    trace("grounder plan list"),
    {
      type: "output",
      text:
        `${bold("All 2 plans:")}\r\n\r\n` +
        `1. ${green("checkout-flow-redesign")}\r\n` +
        `  ${dim("~/vault/10-Projects/your-project/plans/checkout-flow-redesign.md")}\r\n\r\n` +
        `2. ${green("auth-middleware-cleanup")}\r\n` +
        `  ${dim("~/vault/10-Projects/your-project/plans/auth-middleware-cleanup.md")}\r\n\r\n`,
    },
    { type: "wait", seconds: 1.8 },

    // Load the plan that matches current work — plain chat, not just slash commands.
    prompt(),
    ...say("continue with plan 1"),
    trace("Read plans/checkout-flow-redesign.md"),
    {
      type: "output",
      text:
        "Goal: guest checkout without account creation.\r\n" +
        "Shipping form done. Wiring coupon-code validation next.\r\n\r\n",
    },
    { type: "wait", seconds: 1.4 },

    // Quick ad-hoc note mid-session.
    prompt(),
    ...say("/grounder-note coupon codes must apply before tax, not after"),
    trace("grounder note"),
    {
      type: "output",
      text: `${green("Wrote ~/vault/10-Projects/your-project/notes/2026-08-12-1015-coupon-before-tax.md")}\r\n\r\n`,
    },
    { type: "wait", seconds: 1.6 },

    // Close the session with a handoff.
    prompt(),
    ...say("/grounder-task-handoff"),
    trace("grounder handoff"),
    {
      type: "output",
      text: `${green("Wrote ~/vault/10-Projects/your-project/logs/2026-08-12-1730-checkout-flow-redesign.md")}\r\n\r\n`,
    },
    { type: "wait", seconds: 1.4 },

    prompt(),
    { type: "wait", seconds: 1.2 },
  ],
};
