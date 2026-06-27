import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
  readFileSync(path.join(pkgRoot, "package.json"), "utf8"),
) as { version: string };

export const VERSION = pkg.version;
