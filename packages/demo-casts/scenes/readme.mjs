/**
 * README happy-path: typed `grounder note` → vault-relative Wrote line.
 * Entirely fabricated — no shell, no real vault paths.
 */
export default {
  width: 72,
  height: 10,
  cps: 28,
  steps: [
    { type: "output", text: "$ " },
    {
      type: "type",
      text: 'grounder note "Investigate auth middleware"',
    },
    { type: "wait", seconds: 0.35 },
    {
      type: "output",
      text: "\r\nWrote 10-Projects/your-project/notes/2026-07-28-143200-investigate-auth-mid.md\r\n",
    },
    { type: "output", text: "$ " },
    { type: "wait", seconds: 1.2 },
  ],
};
