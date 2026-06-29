# OpenCode Cost Predictor MVP

This repo contains a project-local OpenCode plugin for rich-mode trace collection.

The plugin lives at:

```text
.opencode/plugins/cost-predictor.mjs
```

It is enabled by the project-local config:

```text
.opencode/opencode.json
```

It stores traces outside the repo in a global local SQLite database:

```text
~/.local/share/opencode-cost-predictor/traces.sqlite
```

Use `OPENCODE_COST_PREDICTOR_HOME=/some/path` to override the storage location for tests.

## What It Captures

- OpenCode events visible to project plugins
- observed shell commands from tool/command event payloads
- terminal labeling triggers for:
  - `git commit`
  - `gh pr create`
  - `gh pr ready`
  - `gh pr edit --draft=false` / `--ready`
  - session idle/closure events when OpenCode emits them
- file paths visible in event payloads
- git metadata for the project at write time

Terminal records start as:

```text
outcome = awaiting_label
label_source = pending_user
```

## Label A Pending Session

```bash
python3 .opencode/cost-predictor/store.py label \
  --project-dir "$(pwd)" \
  --outcome success
```

Valid outcomes:

```text
success partial failed abandoned
```

## Inspect Stored Data

```bash
python3 .opencode/cost-predictor/store.py path
python3 .opencode/cost-predictor/store.py pending
python3 .opencode/cost-predictor/store.py show
```

## Infer Stale Pending Labels

Option B keeps sessions pending until the user labels them. To apply fallback inference only to old unanswered records:

```bash
python3 .opencode/cost-predictor/store.py infer-stale --older-than-hours 24
```

This changes only `awaiting_label` records with `label_source = pending_user`.
