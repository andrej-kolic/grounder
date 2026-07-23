import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
    expect(result.stdout).toContain("grounder note");
    expect(result.stdout).not.toContain("grounder status");
  });

  it("requires text for note command", () => {
    const result = run(["note"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: grounder note");
  });
});
