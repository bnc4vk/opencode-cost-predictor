/** @jsxImportSource @opentui/solid */

import { watch } from "node:fs";
import path from "node:path";
import { createSignal } from "solid-js";
import {
  formatModelScoreBreakdown,
  formatModelScoreSummary,
  resolveCurrentModelID,
  resolveModelScore,
} from "./model-score-data.mjs";

export const tui = async (api) => {
  const currentScore = () => resolveModelScore(resolveCurrentModelID(api));
  const currentSummary = () => formatModelScoreSummary(currentScore());
  const [scoreSummary, setScoreSummary] = createSignal(currentSummary());

  const refreshScoreSummary = () => {
    const next = currentSummary();
    setScoreSummary((previous) => (previous === next ? previous : next));
  };

  const modelStateFile = api.state.path.state ? path.join(api.state.path.state, "model.json") : undefined;
  if (modelStateFile) {
    try {
      const watcher = watch(modelStateFile, { persistent: false }, refreshScoreSummary);
      api.lifecycle.onDispose(() => watcher.close());
    } catch {
      // Polling below still catches model changes if fs.watch is unavailable.
    }
  }

  const poll = setInterval(refreshScoreSummary, 1000);
  api.lifecycle.onDispose(() => clearInterval(poll));

  const unregisterCommand = api.command?.register(() => [
    {
      title: "Show model benchmark details",
      value: "cost-predictor.model-benchmark",
      description: "Show Terminal-Bench harnesses, token cost, and token efficiency for the current model.",
      category: "Cost Predictor",
      onSelect(dialog) {
        const stack = dialog ?? api.ui.dialog;
        stack.replace(
          () => (
            <api.ui.DialogAlert
              title="Model Benchmark"
              message={formatModelScoreBreakdown(currentScore())}
              onConfirm={() => stack.clear()}
            />
          ),
        );
      },
    },
  ]);

  if (unregisterCommand) {
    api.lifecycle.onDispose(unregisterCommand);
  }

  api.slots.register({
    slots: {
      home_bottom(ctx) {
        const theme = ctx.theme.current;
        return (
          <box width="100%" height={1} alignItems="center">
            <text fg={theme.textMuted}>{scoreSummary()}</text>
          </box>
        );
      },
    },
  });
};

export default {
  id: "cost-predictor.home",
  tui,
};
