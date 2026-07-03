import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatModelScoreBreakdown,
  formatModelScoreSummary,
  modelRefToID,
  readSelectedModelIDFromState,
  resolveCurrentModelID,
  resolveModelScore,
  resolveModelStats,
} from "../.opencode/plugins/model-score-data.mjs";

const root = path.resolve(import.meta.dirname, "..");
const homePlugin = path.join(root, ".opencode", "plugins", "cost-predictor-home.tsx");
const packageManifest = path.join(root, "package.json");
const scoreUpdater = path.join(root, "scripts", "update-model-scores.mjs");
const tuiConfig = path.join(root, ".opencode", "tui.json");

test("tui config loads only the persistent home-screen plugin", () => {
  const config = JSON.parse(readFileSync(tuiConfig, "utf8"));

  assert.deepEqual(config.plugin, ["./plugins/cost-predictor-home.tsx"]);
});

test("package metadata exposes the npm TUI plugin entrypoint", () => {
  const manifest = JSON.parse(readFileSync(packageManifest, "utf8"));

  assert.equal(manifest.name, "opencode-cost-predictor");
  assert.deepEqual(manifest["oc-plugin"], ["tui"]);
  assert.equal(manifest.exports["./tui"], "./tui.tsx");
  assert.equal(manifest.scripts["update:scores"], "node scripts/update-model-scores.mjs");
});

test("score updater uses Terminal-Bench fallback and Artificial Analysis efficiency sources", () => {
  const source = readFileSync(scoreUpdater, "utf8");

  assert.match(source, /opencodeData: "https:\/\/opencode\.ai\/data\/"/u);
  assert.match(source, /terminalBench21: "https:\/\/www\.tbench\.ai\/leaderboard\/terminal-bench\/2\.1"/u);
  assert.match(source, /terminalBench20: "https:\/\/www\.tbench\.ai\/leaderboard\/terminal-bench\/2\.0"/u);
  assert.match(source, /artificialAnalysisTerminalBench21: "https:\/\/artificialanalysis\.ai\/evaluations\/terminalbench-v2-1"/u);
  assert.match(source, /averageTerminalBenchRows/u);
  assert.match(source, /artificialAnalysisBenchmarkRows/u);
  assert.match(source, /parseArtificialAnalysisTerminalBench21/u);
  assert.match(source, /mergeTokenEfficiency/u);
  assert.doesNotMatch(source, /swebench/iu);
});

test("home-screen plugin renders model benchmark stats without prompt interception", () => {
  const source = readFileSync(homePlugin, "utf8");

  assert.match(source, /home_bottom/u);
  assert.match(source, /alignItems="center"/u);
  assert.match(source, /createSignal\(currentSummary\(\)\)/u);
  assert.match(source, /watch\(modelStateFile/u);
  assert.match(source, /setInterval\(refreshScoreSummary, 1000\)/u);
  assert.match(source, /Show model benchmark details/u);
  assert.match(source, /cost-predictor\.model-benchmark/u);
  assert.match(source, /scoreSummary\(\)/u);
  assert.doesNotMatch(source, /home_prompt/u);
  assert.doesNotMatch(source, /session_prompt/u);
  assert.doesNotMatch(source, /task-aware/u);
  assert.doesNotMatch(source, /slash:/u);
});

test("Terminal-Bench 2.1 model score averages all matching harness rows", () => {
  const score = resolveModelScore("opencode/claude-opus-4-8");

  assert.equal(score.displayScore, "77");
  assert.equal(score.method, "terminal-bench-2.1-average");
  assert.equal(score.benchmark, "Terminal-Bench 2.1");
  assert.equal(score.evidence.length, 2);
  assert.deepEqual(score.evidence.map((item) => item.match), [
    "Claude Code + Claude Opus 4.8",
    "Terminus 2 + Claude Opus 4.8",
  ]);
});

test("models without Terminal-Bench 2.1 rows can fall back to Terminal-Bench 2.0", () => {
  const stats = resolveModelStats("opencode/claude-haiku-4-5");

  assert.equal(stats.displayScore, "52");
  assert.equal(stats.score, 52);
  assert.equal(stats.benchmark.benchmark, "Terminal-Bench 2.0");
  assert.equal(stats.benchmark.harnesses.length, 3);
  assert.match(formatModelScoreSummary(stats), /model score: 52/u);
});

test("summary shows token cost and Artificial Analysis token efficiency", () => {
  const stats = resolveModelStats("opencode/deepseek-v4-flash");

  assert.equal(stats.displayScore, "62");
  assert.equal(stats.benchmark.benchmark, "Artificial Analysis Terminal-Bench v2.1");
  assert.equal(stats.cost.input, 0.14);
  assert.equal(stats.cost.output, 0.28);
  assert.equal(stats.cost.tokenEfficiency, 0.0516);
  assert.equal(stats.cost.tokenEfficiencyBenchmark, "Artificial Analysis Terminal-Bench v2.1");
  assert.equal(stats.cost.tokenEfficiencyHarness, "Terminus 2 in E2B");
  assert.equal(
    formatModelScoreSummary(stats),
    "model score: 62 | token cost (in / out): $0.14 / $0.28 per 1M | token efficiency: 0.05",
  );
});

test("Artificial Analysis score fills models missing official Terminal-Bench rows", () => {
  const stats = resolveModelStats("opencode/kimi-k2.6");
  const breakdown = formatModelScoreBreakdown(stats);

  assert.equal(stats.displayScore, "57");
  assert.equal(stats.score, 57);
  assert.equal(stats.benchmark.benchmark, "Artificial Analysis Terminal-Bench v2.1");
  assert.equal(stats.benchmark.harnesses.length, 1);
  assert.match(breakdown, /- Terminus 2: 57\.3 \(Kimi K2\.6, terminus-2@Artificial Analysis\)/u);
  assert.doesNotMatch(breakdown, /undefined/u);
});

test("benchmark breakdown includes harness and Artificial Analysis token efficiency details", () => {
  const breakdown = formatModelScoreBreakdown(resolveModelStats("opencode/gpt-5.5"));

  assert.match(breakdown, /score method: Terminal-Bench 2\.1 is preferred, Terminal-Bench 2\.0 is used as fallback, then Artificial Analysis Terminal-Bench v2\.1 is used when official rows are missing/u);
  assert.match(breakdown, /- Codex CLI: 83\.4 \(GPT-5\.5, 2026-05-01, codex@0\.125\.0\)/u);
  assert.match(breakdown, /- Terminus 2: 78\.2 \(GPT-5\.5, 2026-05-01, terminus-2@2\.0\.0\)/u);
  assert.match(breakdown, /token cost:/u);
  assert.match(breakdown, /- input: \$5\.00 per 1M tokens/u);
  assert.match(breakdown, /token efficiency:/u);
  assert.match(breakdown, /Artificial Analysis Terminal-Bench v2\.1/u);
  assert.match(breakdown, /Terminus 2 in E2B/u);
  assert.match(breakdown, /pass@1 divided by output tokens/u);
  assert.match(breakdown, /measured model: GPT-5\.5/u);
});

test("preview suffix aliases resolve Terminal-Bench and OpenCode Data cost rows", () => {
  const stats = resolveModelStats("opencode/gemini-3-pro");

  assert.equal(stats.displayScore, "70");
  assert.equal(stats.cost.input, 4);
  assert.equal(stats.cost.output, 18);
  assert.equal(stats.benchmark.harnesses.length, 2);
});

test("current model resolver reads the selected OpenCode model state", () => {
  const statePath = mkdtempSync(path.join(os.tmpdir(), "opencode-model-state-"));
  writeFileSync(
    path.join(statePath, "model.json"),
    JSON.stringify({
      recent: [
        {
          providerID: "opencode",
          modelID: "gemini-3-pro",
        },
      ],
    }),
  );

  assert.equal(readSelectedModelIDFromState(statePath), "opencode/gemini-3-pro");
  assert.equal(
    resolveCurrentModelID({
      state: {
        path: { state: statePath },
        config: { model: "opencode/gpt-5.5" },
      },
    }),
    "opencode/gemini-3-pro",
  );
});

test("current model resolver does not treat provider order as selected state", () => {
  assert.equal(
    resolveCurrentModelID({
      state: {
        path: { state: "/does/not/exist" },
        config: {},
        provider: [
          {
            id: "opencode",
            models: {
              "deepseek-v4-flash": {},
            },
          },
        ],
      },
    }),
    "unknown",
  );
});

test("model refs normalize common OpenCode shapes", () => {
  assert.equal(modelRefToID({ providerID: "opencode", modelID: "claude-opus-4-8" }), "opencode/claude-opus-4-8");
  assert.equal(modelRefToID({ providerID: "opencode", id: "gpt-5.5" }), "opencode/gpt-5.5");
  assert.equal(modelRefToID("opencode/gpt-5.5"), undefined);
});
