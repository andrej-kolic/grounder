/**
 * Normalize a scene module's default export into `{ steps, options }` for compileCast.
 *
 * @param {unknown} mod
 * @param {string} file
 * @returns {{ steps: import("./compile.mjs").Step[]; options: import("./compile.mjs").CompileOptions }}
 */
export function normalizeScene(mod, file) {
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
    `${file}: default export must be a steps array or { steps, width?, height?, cps?, timestamp?, env? }`,
  );
}
