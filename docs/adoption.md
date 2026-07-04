# Adoption Plan

This plan tracks the concrete work needed to make OpenCode Model Scorecard easy
to discover, evaluate, install, and trust.

## Positioning

One-line description:

> Shows local benchmark scores, token costs, and token-efficiency context for
> the selected model in the OpenCode TUI.

Long description:

> OpenCode Model Scorecard adds a persistent home-screen line with benchmark
> score, input/output token price, and token-efficiency context for the selected
> model. Data is bundled at release time from Terminal-Bench, Artificial
> Analysis, and OpenCode Data, so the plugin has no runtime backend.

## Discovery Targets

| Target | Action | Validation |
| --- | --- | --- |
| npm | Publish `opencode-model-scorecard` with clear keywords and public metadata. | `npm view opencode-model-scorecard --json` shows package, keywords, repository, and README. |
| GitHub repo | Add description, topics, release, README badges, preview image, and issue templates. | `gh repo view --json description,repositoryTopics` and release URL are available. |
| OpenCode ecosystem | Submit a PR adding the plugin to the official ecosystem list. | PR URL exists and links to the plugin repository. |
| awesome-opencode | Submit a PR adding the plugin to the curated plugin list. | PR URL exists and links to the plugin repository. |
| opencode.cafe | Submit a marketplace entry or issue with listing copy. | Submission URL, issue URL, or documented blocker exists. |
| Community launch | Publish launch copy to OpenCode Discord, Reddit, and X. | Post URLs exist, or manual-only channels are tracked as blocked. |

## Listing Copy

Short:

```text
OpenCode Model Scorecard - shows model benchmark score, token cost, and token efficiency on the OpenCode TUI home screen.
```

Medium:

```text
OpenCode Model Scorecard adds a persistent home-screen line with benchmark score, input/output token price, and token-efficiency context for the selected model. Data is bundled locally from Terminal-Bench, Artificial Analysis, and OpenCode Data.
```

Install:

```sh
opencode plugin opencode-model-scorecard -g
```

Manual TUI config:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-model-scorecard"]
}
```

## Launch Post

```text
I published OpenCode Model Scorecard, a small TUI plugin that shows model benchmark score, token cost, and token efficiency directly on the OpenCode home screen.

It is meant for the moment when you are choosing between models and want quality/cost context without opening benchmark and pricing pages.

Install:
opencode plugin opencode-model-scorecard -g

Data is bundled locally from Terminal-Bench, Artificial Analysis, and OpenCode Data. No runtime backend.

GitHub: https://github.com/bnc4vk/opencode-model-scorecard
npm: https://www.npmjs.com/package/opencode-model-scorecard

If your preferred model shows n/a, please open a missing-model issue with the exact OpenCode model ID.
```

## 30-Day Metrics

- npm weekly downloads: target 100+.
- GitHub stars: target 10+.
- External missing-model reports: target 3+ useful reports.
- Official ecosystem listing: merged or PR open.
- awesome-opencode listing: merged or PR open.
- opencode.cafe listing: published, submitted, or blocker documented.

## Validation Log

Add links here as external steps are completed:

- npm package: https://www.npmjs.com/package/opencode-model-scorecard
  - Current published version is `0.1.1`.
  - `npm view opencode-model-scorecard --json` resolves successfully.
  - Publishing refreshed README and keyword metadata requires npm auth; local
    `npm whoami` returned `E401 Unauthorized` on July 4, 2026.
- GitHub release: https://github.com/bnc4vk/opencode-model-scorecard/releases/tag/v0.1.1
- CI: https://github.com/bnc4vk/opencode-model-scorecard/actions/runs/28702779222
- OpenCode ecosystem PR: https://github.com/anomalyco/opencode/pull/35304
- awesome-opencode PR: https://github.com/awesome-opencode/awesome-opencode/pull/492
- opencode.cafe submission: https://github.com/R44VC0RP/opencode.cafe/issues/8
  - Website submission form requires an authenticated browser session, so the
    submission was filed as a GitHub issue with complete listing details.
- Reddit post: blocked until a logged-in Reddit account is available.
- Discord post: blocked until a logged-in OpenCode Discord session is available.
- X post: blocked until a logged-in X account is available.
