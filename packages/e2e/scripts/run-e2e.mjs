#!/usr/bin/env node
// Runs every scripts/e2e-*.mjs in sequence — auto-discovered, so adding a new
// e2e script needs no edit here or in package.json's "e2e" entry.
//
// Usage: pnpm build && node packages/e2e/scripts/run-e2e.mjs

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const scripts = readdirSync(scriptsDir)
  .filter((name) => name.startsWith("e2e-") && name.endsWith(".mjs"))
  .sort();

if (scripts.length === 0) {
  console.error(`No scripts/e2e-*.mjs found in ${scriptsDir}`);
  process.exit(1);
}

let failed = false;
for (const script of scripts) {
  console.log(`\n############################################`);
  console.log(`# ${script}`);
  console.log(`############################################`);
  try {
    execFileSync("node", [path.join(scriptsDir, script)], { stdio: "inherit" });
  } catch {
    // Non-zero exit already printed by the child script's own "Result: FAIL" — just
    // keep going so one failing script doesn't hide results from the rest.
    failed = true;
  }
}

console.log(`\n${failed ? "FAIL" : "PASS"} — ran ${scripts.length} e2e script(s).`);
process.exit(failed ? 1 : 0);
