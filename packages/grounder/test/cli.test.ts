import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(pkgRoot, "dist", "cli.js");

function run(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

describe("grounder cli", () => {
  it("prints version", () => {
    const result = run(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("0.0.1");
  });

  it("prints help", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("grounder vault init");
  });

  it("exits non-zero for unimplemented init", () => {
    const result = run(["init"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not implemented yet");
  });
});
