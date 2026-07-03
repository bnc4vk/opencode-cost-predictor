# OpenCode Cost Predictor Home UI

This repo contains a project-local OpenCode TUI plugin focused on one form
factor: a persistent home-screen status line for the currently selected model.

The plugin lives at:

```text
.opencode/plugins/cost-predictor-home.tsx
```

It is enabled by:

```text
.opencode/tui.json
```

## Current UI

The plugin renders this line on OpenCode's home screen:

```text
model score: 77 | token cost (in / out): $5.00 / $25.01 per 1M | token efficiency: 0.08
```

Use the `Show model benchmark details` TUI command to see the Terminal-Bench
harness rows, token costs, and token efficiency calculation details for the
displayed model.

## Model Score

The model score uses Terminal-Bench 2.1 when available, Terminal-Bench 2.0 as a
fallback, then Artificial Analysis Terminal-Bench v2.1 when official rows are
missing. When a model has multiple matching harness rows, the plugin averages all
of them. The details dialog lists each harness row included in the average,
including mixed-model harness rows when they exist in the source data.

Models without one of these Terminal-Bench score sources show `n/a`. There is
deliberately no fallback to SWE-bench or unrelated benchmark families.

## Token Cost

Token cost uses the OpenCode Data model catalog:

```text
token cost (in / out): $0.14 / $0.28 per 1M
```

When available, cached input cost is shown in the details dialog.

## Token Efficiency

Token efficiency uses real observed benchmark or usage data. The preferred
source is Artificial Analysis Terminal-Bench v2.1:

```text
Terminal-Bench v2.1 pass@1 / output tokens, normalized to the best fetched model
```

When Artificial Analysis does not expose a matching model object with token
counts, the generator can retain OpenCode Data session-cost rows as a real
observed fallback. Models without either source show `n/a`.

## Score Refreshes

The registry is local at runtime. To prepare a release with updated public data,
run from the repo root:

```sh
npm run update:scores
npm test
npm run pack:dry-run
```

The refresh command rewrites only the generated data arrays in
`.opencode/plugins/model-score-data.mjs`.

For npm distribution, the package exports the TUI plugin at:

```text
opencode-cost-predictor/tui
```
