#!/usr/bin/env node
/**
 * Load scenes/*.mjs → out/<name>.cast (canonical) + out/<name>.gif via `agg`.
 * No PTY / live shell — scenes are hand-authored. Fails if `agg` is missing.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileCast } from "./compile.mjs";
import { normalizeScene } from "./scene.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scenesDir = join(root, "scenes");
const outDir = join(root, "out");

const AGG_MISSING =
  "agg not found on PATH — install once with `brew install agg` (or a cargo/release binary from https://github.com/asciinema/agg)";

/**
 * @param {unknown} err
 */
function isEnoent(err) {
  return Boolean(err && typeof err === "object" && "code" in err && err.code === "ENOENT");
}

/** Ensure `agg` is on PATH before compiling any scene. */
function requireAgg() {
  try {
    execFileSync("agg", ["--version"], { stdio: "ignore" });
  } catch (err) {
    if (isEnoent(err)) {
      throw new Error(AGG_MISSING);
    }
    throw err;
  }
}

/**
 * @param {string} castPath
 * @param {string} gifPath
 */
function renderGif(castPath, gifPath) {
  try {
    // End hold must be --last-frame-duration: agg ignores trailing empty
    // cast events (and no-op ANSI), so scene `wait` alone never lengthens the GIF.
    execFileSync(
      "agg",
      ["--last-frame-duration", "3", "--idle-time-limit", "10", castPath, gifPath],
      { stdio: "ignore" },
    );
  } catch (err) {
    if (isEnoent(err)) {
      throw new Error(AGG_MISSING);
    }
    const status =
      err && typeof err === "object" && "status" in err
        ? /** @type {{ status?: unknown }} */ (err).status
        : null;
    throw new Error(
      status != null
        ? `agg failed rendering ${basename(castPath)} (exit ${status})`
        : `agg failed rendering ${basename(castPath)}`,
    );
  }
}

async function main() {
  requireAgg();
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
    const castPath = join(outDir, `${name}.cast`);
    const gifPath = join(outDir, `${name}.gif`);
    writeFileSync(castPath, cast);
    const events = cast.trimEnd().split("\n").length - 1;
    console.log(`wrote out/${name}.cast (${events} events)`);
    renderGif(castPath, gifPath);
    console.log(`wrote out/${name}.gif`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
