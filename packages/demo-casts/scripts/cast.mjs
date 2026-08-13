#!/usr/bin/env node
/**
 * Load scenes/*.mjs and write asciicast v2 JSONL to out/<name>.cast.
 * GIF rendering via `agg` is step 4 — this step only emits .cast files.
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileCast } from "./compile.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scenesDir = join(root, "scenes");
const outDir = join(root, "out");

/**
 * @param {unknown} mod
 * @param {string} file
 */
function normalizeScene(mod, file) {
  const exported = /** @type {{ default?: unknown }} */ (mod).default ?? mod;

  if (Array.isArray(exported)) {
    return { steps: exported, options: {} };
  }

  if (
    exported &&
    typeof exported === "object" &&
    Array.isArray(/** @type {{ steps?: unknown }} */ (exported).steps)
  ) {
    const {
      steps,
      width,
      height,
      cps,
      timestamp,
      env,
      name: _name,
      ...rest
    } = /** @type {Record<string, unknown>} */ (exported);

    if (Object.keys(rest).length > 0) {
      throw new Error(`${file}: unexpected scene fields: ${Object.keys(rest).join(", ")}`);
    }

    return {
      steps: /** @type {import("./compile.mjs").Step[]} */ (steps),
      options: {
        ...(width !== undefined ? { width: /** @type {number} */ (width) } : {}),
        ...(height !== undefined ? { height: /** @type {number} */ (height) } : {}),
        ...(cps !== undefined ? { cps: /** @type {number} */ (cps) } : {}),
        ...(timestamp !== undefined ? { timestamp: /** @type {number} */ (timestamp) } : {}),
        ...(env !== undefined ? { env: /** @type {Record<string, string>} */ (env) } : {}),
      },
    };
  }

  throw new Error(
    `${file}: default export must be a steps array or { steps, width?, height?, cps? }`,
  );
}

async function main() {
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(scenesDir)
    .filter((f) => f.endsWith(".mjs"))
    .sort();

  if (files.length === 0) {
    console.log("no scenes/*.mjs found — nothing to compile");
    return;
  }

  for (const file of files) {
    const path = join(scenesDir, file);
    const mod = await import(pathToFileURL(path).href);
    const { steps, options } = normalizeScene(mod, file);
    const name = basename(file, ".mjs");
    const cast = compileCast(steps, options);
    const outPath = join(outDir, `${name}.cast`);
    writeFileSync(outPath, cast);
    const events = cast.trimEnd().split("\n").length - 1;
    console.log(`wrote out/${name}.cast (${events} events)`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
