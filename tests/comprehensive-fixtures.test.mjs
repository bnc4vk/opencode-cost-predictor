import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const sourceOpencode = path.join(root, ".opencode");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    text: true,
    encoding: "utf8",
    ...options,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function makeFixture(kind) {
  const dir = mkdtempSync(path.join(tmpdir(), `${kind}-fixture-`));
  const realDir = realpathSync(dir);
  cpSync(sourceOpencode, path.join(realDir, ".opencode"), { recursive: true });
  run("git", ["init"], { cwd: realDir });
  run("git", ["config", "user.email", "tester@example.com"], { cwd: realDir });
  run("git", ["config", "user.name", "Cost Predictor Tester"], { cwd: realDir });

  if (kind === "pollen") {
    writeFileSync(
      path.join(realDir, "package.json"),
      JSON.stringify(
        {
          name: "pollen-fixture",
          scripts: {
            build: "vite build",
            start: "node server/index.js",
            "worker:deploy": "wrangler deploy",
          },
          dependencies: {
            react: "^19.0.0",
            vite: "^7.0.0",
            express: "^5.0.0",
            leaflet: "^1.9.0",
          },
        },
        null,
        2,
      ),
    );
    mkdirSync(path.join(realDir, "server"), { recursive: true });
    mkdirSync(path.join(realDir, "src"), { recursive: true });
    writeFileSync(path.join(realDir, "README.md"), "# Pollen Forecast Fixture\n");
    writeFileSync(path.join(realDir, "server", "index.js"), "export const api = true;\n");
    writeFileSync(path.join(realDir, "src", "main.jsx"), "export const app = 'pollen';\n");
  } else {
    writeFileSync(
      path.join(realDir, "package.json"),
      JSON.stringify(
        {
          name: "custom-ledger-fixture",
          scripts: {
            build: "tsc -b && vite build",
            lint: "eslint .",
          },
          dependencies: {
            react: "^19.0.0",
            "@supabase/supabase-js": "^2.0.0",
            "tesseract.js": "^6.0.0",
          },
        },
        null,
        2,
      ),
    );
    mkdirSync(path.join(realDir, "src"), { recursive: true });
    mkdirSync(path.join(realDir, "supabase"), { recursive: true });
    writeFileSync(path.join(realDir, "README.md"), "# Custom Ledger Fixture\n");
    writeFileSync(path.join(realDir, "src", "App.tsx"), "export function App() { return null }\n");
    writeFileSync(path.join(realDir, "supabase", "schema.sql"), "create table ledgers(id text primary key);\n");
  }

  run("git", ["add", "."], { cwd: realDir });
  run("git", ["commit", "-m", "initial fixture"], { cwd: realDir });
  return realDir;
}

async function loadFixturePlugin(dir, home) {
  process.env.OPENCODE_COST_PREDICTOR_HOME = home;
  const pluginPath = path.join(dir, ".opencode", "plugins", "cost-predictor.mjs");
  const mod = await import(`${pluginPath}?cacheBust=${Date.now()}-${Math.random()}`);
  return mod.CostPredictor();
}

function storePath(dir) {
  return path.join(dir, ".opencode", "cost-predictor", "store.py");
}

function runStore(dir, home, ...args) {
  return run("python3", [storePath(dir), ...args], {
    cwd: dir,
    env: { OPENCODE_COST_PREDICTOR_HOME: home },
  });
}

test("pollen-like fixture records PR publish trigger outside repo", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "opencode-cost-home-"));
  const dir = makeFixture("pollen");
  const hooks = await loadFixturePlugin(dir, home);

  await hooks["tool.execute.after"](
    {
      sessionID: "pollen-session",
      tool: "bash",
      args: {
        command: "npm run build && gh pr create --draft --fill",
      },
      file: "server/index.js",
    },
    {
      output: "created pull request",
    },
  );

  const pending = JSON.parse(runStore(dir, home, "pending"));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].session_key, "pollen-session");
  assert.equal(pending[0].trigger_type, "github_pr_publish");
  assert.equal(pending[0].project_dir, dir);
  assert.equal(existsSync(path.join(dir, ".opencode-cost")), false);
});

test("fixture project config makes OpenCode report the plugin as loaded", () => {
  const dir = makeFixture("pollen");
  const output = run("opencode", ["debug", "info"], { cwd: dir });
  assert.match(output, /plugins:\n- file:\/\/.*cost-predictor\.mjs/u);
});

test("custom-ledger-like fixture handles command.executed and user label", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "opencode-cost-home-"));
  const dir = makeFixture("custom-ledger");
  const hooks = await loadFixturePlugin(dir, home);

  await hooks["command.executed"]({
    session: { id: "ledger-session" },
    command: "git commit --amend --no-edit",
    path: "src/App.tsx",
  });

  let pending = JSON.parse(runStore(dir, home, "pending"));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].trigger_type, "git_commit");

  const labeled = JSON.parse(
    runStore(dir, home, "label", "--project-dir", dir, "--outcome", "partial"),
  );
  assert.equal(labeled.session_key, "ledger-session");
  assert.equal(labeled.outcome, "partial");

  pending = JSON.parse(runStore(dir, home, "pending"));
  assert.equal(pending.length, 0);
});

test("generic event and session.idle create separate terminal records by session", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "opencode-cost-home-"));
  const dir = makeFixture("pollen");
  const hooks = await loadFixturePlugin(dir, home);

  await hooks.event({
    event: {
      type: "message.updated",
      properties: {
        sessionId: "event-session",
        command: "git status",
      },
    },
  });

  await hooks["session.idle"]({
    sessionID: "idle-session",
    reason: "test complete",
  });

  const pending = JSON.parse(runStore(dir, home, "pending"));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].session_key, "idle-session");
  assert.equal(pending[0].trigger_type, "session_closure");

  const show = JSON.parse(runStore(dir, home, "show", "--limit", "10"));
  const sessionKeys = new Set(show.sessions.map((session) => session.session_key));
  assert.equal(sessionKeys.has("event-session"), true);
  assert.equal(sessionKeys.has("idle-session"), true);
});

test("stale inference preserves user-confirmed labels across fixture repos", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "opencode-cost-home-"));
  const pollen = makeFixture("pollen");
  const ledger = makeFixture("custom-ledger");

  const oldPending = {
    sessionKey: "old-pollen",
    projectDir: pollen,
    createdAt: "2026-06-28T00:00:00Z",
    triggerType: "session_closure",
    outcome: "awaiting_label",
    labelSource: "pending_user",
  };
  const oldConfirmed = {
    sessionKey: "old-ledger-confirmed",
    projectDir: ledger,
    createdAt: "2026-06-28T00:00:00Z",
    triggerType: "git_commit",
    outcome: "awaiting_label",
    labelSource: "pending_user",
  };

  runStore(pollen, home, "record-terminal", "--project-dir", pollen, "--payload-json", JSON.stringify(oldPending));
  runStore(ledger, home, "record-terminal", "--project-dir", ledger, "--payload-json", JSON.stringify(oldConfirmed));
  runStore(ledger, home, "label", "--project-dir", ledger, "--outcome", "success");

  const inferred = JSON.parse(runStore(pollen, home, "infer-stale", "--older-than-hours", "1"));
  assert.equal(inferred.updated.length, 1);
  assert.equal(inferred.updated[0].session_key, "old-pollen");
  assert.equal(inferred.updated[0].outcome, "abandoned");

  const show = JSON.parse(runStore(pollen, home, "show", "--limit", "10"));
  const records = new Map(show.terminal_records.map((record) => [record.session_key, record]));
  assert.equal(records.get("old-ledger-confirmed").outcome, "success");
  assert.equal(records.get("old-ledger-confirmed").label_source, "user_confirmed");
  assert.equal(records.get("old-pollen").label_source, "inferred_no_user_response");
});
