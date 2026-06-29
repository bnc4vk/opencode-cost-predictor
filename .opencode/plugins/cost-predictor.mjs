import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  classifyCommand,
  eventType,
  extractCommands,
  extractFilePaths,
  extractSessionId,
  nowIso,
  safeJson,
  sessionKey,
} from "../cost-predictor/lib.mjs";

const pluginFile = fileURLToPath(import.meta.url);
const pluginDir = path.dirname(pluginFile);
const projectDir = path.resolve(pluginDir, "../..");
const storeScript = path.resolve(pluginDir, "../cost-predictor/store.py");

let lastSessionKey = null;

function callStore(command, payload) {
  const result = spawnSync(
    "python3",
    [storeScript, command, "--project-dir", projectDir, "--payload-json", safeJson(payload)],
    {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    },
  );

  if (result.status !== 0) {
    console.error(`[cost-predictor] store ${command} failed`, result.stderr || result.stdout);
  }
}

function buildPayload(kind, raw, extra = {}) {
  const sessionId = extractSessionId(raw);
  const key = sessionKey({
    sessionId,
    projectDir,
    fallback: lastSessionKey || `${process.pid}-${Date.now()}`,
  });
  lastSessionKey = key;

  return {
    projectDir,
    sessionId,
    sessionKey: key,
    eventType: kind,
    createdAt: nowIso(),
    filesTouched: extractFilePaths(raw),
    raw,
    ...extra,
  };
}

function recordEvent(kind, raw) {
  const payload = buildPayload(kind, raw);
  if (!payload.sessionId && !extractCommands(raw).length) return;
  callStore("ingest-event", payload);
}

function recordCommand(raw, command) {
  const trigger = classifyCommand(command);
  const payload = buildPayload("command_observed", raw, {
    command,
    triggerType: trigger?.triggerType ?? null,
  });
  callStore("record-command", payload);

  if (!trigger) return;

  callStore("record-terminal", {
    ...payload,
    triggerType: trigger.triggerType,
    triggerCommand: command,
    outcome: trigger.outcome,
    labelSource: trigger.labelSource,
    confidence: trigger.confidence,
    metadata: {
      prompt: "Did this task reach the intended outcome?",
      allowedOutcomes: ["success", "partial", "failed", "abandoned"],
      labelCommand: `python3 .opencode/cost-predictor/store.py label --project-dir "${projectDir}" --outcome success`,
    },
  });

  console.error(
    `[cost-predictor] ${trigger.triggerType} observed; session is awaiting outcome label. ` +
      `Run: python3 .opencode/cost-predictor/store.py label --project-dir "${projectDir}" --outcome <success|partial|failed|abandoned>`,
  );
}

function observeCommands(kind, raw) {
  const commands = extractCommands(raw);
  recordEvent(kind, raw);
  for (const command of commands) {
    recordCommand(raw, command);
  }
}

export const CostPredictor = async () => {
  return {
    event: async ({ event }) => {
      const kind = eventType(undefined, event);
      observeCommands(kind, event);
    },

    "tool.execute.after": async (input, output) => {
      observeCommands("tool.execute.after", { input, output });
    },

    "command.executed": async (input) => {
      observeCommands("command.executed", input);
    },

    "session.idle": async (input) => {
      const payload = buildPayload("session_idle", input, {
        triggerType: "session_closure",
      });
      callStore("ingest-event", payload);
      callStore("record-terminal", {
        ...payload,
        triggerType: "session_closure",
        triggerCommand: null,
        outcome: "awaiting_label",
        labelSource: "pending_user",
        confidence: null,
        metadata: {
          prompt: "Did this task reach the intended outcome?",
          allowedOutcomes: ["success", "partial", "failed", "abandoned"],
          labelCommand: `python3 .opencode/cost-predictor/store.py label --project-dir "${projectDir}" --outcome success`,
        },
      });
      console.error(
        `[cost-predictor] session idle observed; session is awaiting outcome label. ` +
          `Run: python3 .opencode/cost-predictor/store.py label --project-dir "${projectDir}" --outcome <success|partial|failed|abandoned>`,
      );
    },
  };
};
