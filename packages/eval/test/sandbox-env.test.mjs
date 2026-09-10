import assert from "node:assert/strict";
import { test } from "node:test";
import { sandboxEnv } from "../lib/sandbox.mjs";

test("stripsGrounderVault_whenPresentInProcessEnv", () => {
  const original = process.env.GROUNDER_VAULT;
  process.env.GROUNDER_VAULT = "/real/vault";
  try {
    const env = sandboxEnv({ GROUNDER_HOME: "/scratch/home" });
    assert.equal(env.GROUNDER_VAULT, undefined);
  } finally {
    if (original === undefined) {
      delete process.env.GROUNDER_VAULT;
    } else {
      process.env.GROUNDER_VAULT = original;
    }
  }
});

test("keepsExtraAndInheritedVars_whenGrounderVaultAbsent", () => {
  const original = process.env.GROUNDER_VAULT;
  delete process.env.GROUNDER_VAULT;
  process.env.SANDBOX_ENV_TEST_MARKER = "inherited";
  try {
    const env = sandboxEnv({ GROUNDER_HOME: "/scratch/home" });
    assert.equal(env.GROUNDER_HOME, "/scratch/home");
    assert.equal(env.SANDBOX_ENV_TEST_MARKER, "inherited");
  } finally {
    delete process.env.SANDBOX_ENV_TEST_MARKER;
    if (original !== undefined) {
      process.env.GROUNDER_VAULT = original;
    }
  }
});
