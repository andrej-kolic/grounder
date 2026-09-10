import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractFromClaudeEvents,
  extractFromCursorAgentEvents,
  findEscapedWorkingDir,
  parseNdjson,
} from "../lib/run-agent.mjs";

test("parseNdjson_skipsBlankLinesAndNonJsonNoise", () => {
  const stdout = ['{"type":"a"}', "", "  ", "not json", '{"type":"b"}', ""].join("\n");
  assert.deepEqual(parseNdjson(stdout), [{ type: "a" }, { type: "b" }]);
});

test("extractFromClaudeEvents_collectsOnlyBashToolUseCommands", () => {
  const events = [
    {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "doing stuff" },
          { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
          { type: "tool_use", name: "Read", input: { file_path: "/tmp/x" } },
          { type: "tool_use", name: "Bash", input: { command: "cat foo.md" } },
        ],
      },
    },
    { type: "result", result: "final answer text" },
  ];
  const { commands, finalText } = extractFromClaudeEvents(events);
  assert.deepEqual(commands, ["ls -la", "cat foo.md"]);
  assert.equal(finalText, "final answer text");
});

test("extractFromClaudeEvents_ignoresMalformedToolUseBlocks", () => {
  const events = [
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } },
    { type: "assistant", message: {} },
    { type: "result", result: 42 },
  ];
  const { commands, finalText } = extractFromClaudeEvents(events);
  assert.deepEqual(commands, []);
  assert.equal(finalText, "");
});

function shellToolCall(command, workingDirectory) {
  return {
    type: "tool_call",
    subtype: "completed",
    tool_call: { shellToolCall: { args: { command, workingDirectory } } },
  };
}

test("extractFromCursorAgentEvents_collectsShellCommandsAndWorkingDirs", () => {
  const events = [
    shellToolCall("ls -la", "/tmp/sandbox"),
    shellToolCall("echo hi", "/tmp/sandbox"),
    { type: "result", result: "done" },
  ];
  const { commands, workingDirs, finalText } = extractFromCursorAgentEvents(events);
  assert.deepEqual(commands, ["ls -la", "echo hi"]);
  assert.deepEqual(workingDirs, ["/tmp/sandbox", "/tmp/sandbox"]);
  assert.equal(finalText, "done");
});

test("extractFromCursorAgentEvents_collectsEditDeleteAndWritePaths", () => {
  const events = [
    {
      type: "tool_call",
      subtype: "completed",
      tool_call: { editToolCall: { args: { path: "/v/edited.md" } } },
    },
    {
      type: "tool_call",
      subtype: "completed",
      tool_call: { deleteToolCall: { args: { path: "/v/deleted.md" } } },
    },
    {
      type: "tool_call",
      subtype: "completed",
      tool_call: { writeToolCall: { args: { path: "/v/written.md" } } },
    },
  ];
  const { writes } = extractFromCursorAgentEvents(events);
  assert.deepEqual(writes, ["/v/edited.md", "/v/deleted.md", "/v/written.md"]);
});

test("extractFromCursorAgentEvents_ignoresIncompleteToolCalls", () => {
  const events = [
    {
      type: "tool_call",
      subtype: "started",
      tool_call: { shellToolCall: { args: { command: "ls" } } },
    },
  ];
  const { commands, writes } = extractFromCursorAgentEvents(events);
  assert.deepEqual(commands, []);
  assert.deepEqual(writes, []);
});

test("findEscapedWorkingDir_returnsUndefined_whenAllDirsMatchCwd", () => {
  const cwd = "/tmp/sandbox";
  assert.equal(findEscapedWorkingDir(["/tmp/sandbox", "/tmp/sandbox/sub"], cwd), undefined);
});

test("findEscapedWorkingDir_findsADirOutsideCwd", () => {
  const cwd = "/tmp/sandbox";
  const escaped = findEscapedWorkingDir(["/tmp/sandbox", "/Users/real/vault"], cwd);
  assert.equal(escaped, "/Users/real/vault");
});

test("findEscapedWorkingDir_flagsASimilarlyNamedSiblingDirAsEscaped", () => {
  // "/tmp/sandbox-other" is not inside "/tmp/sandbox" despite the string prefix match —
  // the trailing "/" in the startsWith check is what tells them apart.
  const cwd = "/tmp/sandbox";
  const escaped = findEscapedWorkingDir(["/tmp/sandbox-other"], cwd);
  assert.equal(escaped, "/tmp/sandbox-other");
});
