# OpenCode Cost Predictor

OpenCode TUI plugin that displays local benchmark and token-cost context on the
home screen:

```text
model score: 77 | token cost (in / out): $5.00 / $25.01 per 1M | token efficiency: 0.08
```

The model score uses Terminal-Bench 2.1 when available, Terminal-Bench 2.0 as a
fallback, then Artificial Analysis Terminal-Bench v2.1 when official rows are
missing. Token costs come from the OpenCode Data model catalog. Token efficiency
uses real Artificial Analysis Terminal-Bench v2.1 score and output token data
when available, with OpenCode session-cost rows retained as a real observed
fallback. All data is bundled into the package at release time and resolved
locally at runtime.

## Install From npm

After publishing, add the TUI plugin to your OpenCode TUI config:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-cost-predictor/tui"]
}
```

## Score Refreshes

Maintainers can refresh the hardcoded benchmark registry before publishing a new
npm release:

```sh
npm run update:scores
npm test
npm run pack:dry-run
npm version patch
npm publish
```

The refresh command uses Terminal-Bench 2.1, Terminal-Bench 2.0, Artificial
Analysis Terminal-Bench v2.1, and OpenCode Data, then rewrites only the marked
data arrays in `.opencode/plugins/model-score-data.mjs`. End users do not need a
backend or a network call at runtime.
