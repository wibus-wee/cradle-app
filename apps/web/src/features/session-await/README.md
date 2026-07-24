# Session Await Feature

Renderer-owned UI for chat session awaits in the right aside. The feature lets a user create GitHub checks or review awaits for the active session, inspect live status for pending awaits, review terminal await history, and retry delivery failures.

## Files

- **await-panel-loader.ts**: Shared lazy loader and intent preload entry for the right aside Feed tab.
- **awaits-overview.tsx**: Full-tab query/navigation container for pending awaits from the Desktop read-only projection; opening an await's chat session calls the chat-owned prefetch boundary before activating the Chat tab.
- **awaits-overview-view.tsx / await-row-view.tsx**: Fixture-driven overview and row Views for populated, empty, and unavailable states. They receive owner `DesktopAwaitItem` values and callbacks without reading queries or navigation.
- **await-panel.tsx**: Thin query/mutation adapter for session await rows, bulk live status, cancel, delivery retry, and optional-check bypass actions.
- **await-panel-view.tsx / await-source-card-view.tsx**: Fixture-driven panel and stored/live source card Views for active, terminal, unsupported, and delivery-failure states.
- **github-await-composer-view.tsx / use-github-await-composer.ts**: Local form interaction View plus git detection/create mutation adapter. The View owns target validation without reading repositories or generated clients.
- **github-ci-await-card-view.tsx / github-review-await-card-view.tsx**: Pure GitHub status Views. CI checks render success, failure, skipped/cancelled, and running states with separate icon semantics.
- **await-check-tree.ts / await-check-tree-view.tsx**: Pure workflow/check/step tree construction and rendering; optional-check bypass is exposed as a callback.
- **await-github.ts**: GitHub repository detection and target parsing helpers for human-created awaits, including GitHub check-run `/runs/<id>` URLs and explicit explanations for unsupported workflow run URLs.
- **await-github.test.ts**: Regression coverage for GitHub repo detection, target parsing, and PR-number inference.

## GitHub Composer

The composer supports two GitHub await sources:

- `github-ci`: waits for check runs plus legacy commit statuses on a PR head or commit/ref, or waits for one explicit GitHub check run when the target is a `/runs/<id>` URL.
- `github-review`: waits for PR review signals. Review awaits require a PR number because review state is PR-scoped.

The target input intentionally has no separate PR/commit type switch. A positive integer is treated as a PR number; a GitHub check-run URL containing `/runs/<id>` is treated as `runs_id`; any other valid Git ref/SHA string is treated as a commit/ref for checks. GitHub Actions workflow run URLs are not treated as check-run targets because they represent workflow runs, not the check-run ID currently owned by the server source.
