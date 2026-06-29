import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyCommand,
  commandSegments,
  extractCommands,
  extractSessionId,
} from "../.opencode/cost-predictor/lib.mjs";

test("classifies git commit commands as terminal triggers", () => {
  assert.equal(classifyCommand("git commit -m fix").triggerType, "git_commit");
  assert.equal(classifyCommand("git commit --amend --no-edit").triggerType, "git_commit");
  assert.equal(classifyCommand("cd repo && git commit -m fix").triggerType, "git_commit");
  assert.equal(classifyCommand("git -C repo commit -m fix").triggerType, "git_commit");
});

test("classifies GitHub PR publish commands", () => {
  assert.equal(classifyCommand("gh pr create --fill").triggerType, "github_pr_publish");
  assert.equal(classifyCommand("gh pr ready 42").triggerType, "github_pr_publish");
  assert.equal(classifyCommand("gh pr edit 42 --draft=false").triggerType, "github_pr_publish");
  assert.equal(classifyCommand("gh pr edit 42 --ready").triggerType, "github_pr_publish");
});

test("ignores non-terminal git and gh commands", () => {
  assert.equal(classifyCommand("git status"), null);
  assert.equal(classifyCommand("git diff"), null);
  assert.equal(classifyCommand("gh pr view"), null);
  assert.equal(classifyCommand("npm test"), null);
});

test("splits shell command chains into segments", () => {
  assert.deepEqual(commandSegments("npm test && git commit -m fix; gh pr create"), [
    "npm test",
    "git commit -m fix",
    "gh pr create",
  ]);
});

test("extracts commands from nested OpenCode-like payloads", () => {
  const commands = extractCommands({
    input: {
      tool: "bash",
      args: {
        command: "npm test && git commit -m fix",
      },
    },
    output: {
      metadata: {
        command: "git status",
      },
    },
  });
  assert.deepEqual(commands, ["npm test && git commit -m fix", "git status"]);
});

test("extracts session ids from common payload shapes", () => {
  assert.equal(extractSessionId({ sessionID: "ses_1" }), "ses_1");
  assert.equal(extractSessionId({ session: { id: "ses_2" } }), "ses_2");
  assert.equal(extractSessionId({ properties: { sessionId: "ses_3" } }), "ses_3");
});
