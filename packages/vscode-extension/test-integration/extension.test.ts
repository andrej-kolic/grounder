import * as assert from "node:assert/strict";
import * as vscode from "vscode";

const EXTENSION_ID = "grounder-dev.grounder-vscode-extension";

/**
 * Harness smoke test (Step 10a) — proves `@vscode/test-electron` can boot a
 * real Extension Development Host and load this extension at all. Real
 * command/tree/drag-and-drop coverage against vault content lands in 10b/10c.
 *
 * Mocha's `tdd` interface (`@vscode/test-cli`'s default, and the convention
 * used by VS Code's own extension samples), not `describe`/`it`.
 */
suite("extension activation", () => {
  test("activates and registers its commands", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `expected extension ${EXTENSION_ID} to be installed`);

    await extension.activate();
    assert.equal(extension.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("grounder.refresh"),
      "expected grounder.refresh to be a registered command",
    );
  });
});
