#!/usr/bin/env node

import { execSync } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(root, "fixtures", "dev");

async function hasGitRepo(dir) {
  try {
    await access(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (await hasGitRepo(fixtureDir)) {
    process.stdout.write("fixtures/dev: git already initialized\n");
  } else {
    execSync("git init", { cwd: fixtureDir, stdio: "inherit" });
    execSync('git config user.email "dev@grounder.local"', {
      cwd: fixtureDir,
      stdio: "inherit",
    });
    execSync('git config user.name "Grounder Dev"', {
      cwd: fixtureDir,
      stdio: "inherit",
    });
    process.stdout.write("fixtures/dev: initialized git repo\n");
  }

  process.stdout.write("\nNext steps:\n");
  process.stdout.write("  pnpm grounder vault init ~/Documents/obsidian/dev --yes\n");
  process.stdout.write("  cd fixtures/dev && pnpm grounder init --yes\n");
  process.stdout.write('  pnpm grounder note "hello from dev fixture"\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
