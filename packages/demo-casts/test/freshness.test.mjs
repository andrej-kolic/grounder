/**
 * Guard: committed out/<name>.cast must match a fresh compile of scenes/<name>.mjs.
 * Catches scene edits that forgot `pnpm demo:cast` / `pnpm --filter @grounder/demo-casts build`.
 * Does not require `agg` (GIF freshness is still a manual rebuild step).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileCast } from "../scripts/compile.mjs";
import { normalizeScene } from "../scripts/scene.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scenesDir = join(root, "scenes");
const outDir = join(root, "out");

const sceneFiles = readdirSync(scenesDir)
  .filter((f) => f.endsWith(".mjs"))
  .sort();

describe("out/ cast freshness", () => {
  it("finds at least one scene", () => {
    assert.ok(sceneFiles.length > 0, "expected scenes/*.mjs");
  });

  for (const file of sceneFiles) {
    const name = basename(file, ".mjs");
    it(`${name}.cast matches scenes/${file}`, async () => {
      const mod = await import(pathToFileURL(join(scenesDir, file)).href);
      const { steps, options } = normalizeScene(mod, file);
      const expected = compileCast(steps, options);
      const castPath = join(outDir, `${name}.cast`);
      let onDisk;
      try {
        onDisk = readFileSync(castPath, "utf8");
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
          assert.fail(
            `missing out/${name}.cast — run \`pnpm demo:cast\` (or pnpm --filter @grounder/demo-casts build)`,
          );
        }
        throw err;
      }
      assert.equal(
        onDisk,
        expected,
        `out/${name}.cast is stale vs scenes/${file} — run \`pnpm demo:cast\``,
      );
    });
  }
});
