import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { CostPredictor } from "../.opencode/plugins/cost-predictor.mjs";

const root = path.resolve(import.meta.dirname, "..");
const store = path.join(root, ".opencode", "cost-predictor", "store.py");

function runStore(home, ...args) {
  const result = spawnSync("python3", [store, ...args], {
    cwd: root,
    env: {
      ...process.env,
      OPENCODE_COST_PREDICTOR_HOME: home,
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test("plugin hook records command trigger as awaiting label", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "opencode-cost-plugin-"));
  process.env.OPENCODE_COST_PREDICTOR_HOME = home;

  const hooks = await CostPredictor();
  await hooks["tool.execute.after"](
    {
      sessionID: "plugin-session",
      tool: "bash",
      args: {
        command: 'git commit -m "mvp"',
      },
    },
    {
      output: "[main abc123] mvp",
    },
  );

  const pending = JSON.parse(runStore(home, "pending"));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].session_key, "plugin-session");
  assert.equal(pending[0].trigger_type, "git_commit");
});
