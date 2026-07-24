# Session Await Feature

Renderer-owned UI for chat session awaits in the right aside. The feature lets a user create GitHub checks or review awaits for the active session, inspect live status for pending awaits, review terminal await history, and retry delivery failures.

## Files

- **await-panel-loader.ts**: Shared lazy loader and intent preload entry for the right aside Feed tab.
- **awaits-overview.tsx**: Full-tab overview of pending awaits from the Desktop read-only projection; opening an await's chat session calls the chat-owned prefetch boundary before activating the Chat tab.
- **await-panel.tsx**: Await panel, GitHub composer, source cards, check/status tree rendering, PR review status rendering, terminal await history, target input validation feedback, and delivery retry; GitHub checks render success, failure, skipped/cancelled, and running states with separate icon semantics; session await reads use the shared interactive query refresh policy and live GitHub status keeps an explicit slower interval for pending awaits only; records the global right-aside Feed first-render mark once per module lifetime after the session awaits query succeeds.
- **await-github.ts**: GitHub repository detection and target parsing helpers for human-created awaits, including GitHub check-run `/runs/<id>` URLs and explicit explanations for unsupported workflow run URLs.
- **await-github.test.ts**: Regression coverage for GitHub repo detection, target parsing, and PR-number inference.

## GitHub Composer

The composer supports two GitHub await sources:

- `github-ci`: waits for check runs plus legacy commit statuses on a PR head or commit/ref, or waits for one explicit GitHub check run when the target is a `/runs/<id>` URL.
- `github-review`: waits for PR review signals. Review awaits require a PR number because review state is PR-scoped.

The target input intentionally has no separate PR/commit type switch. A positive integer is treated as a PR number; a GitHub check-run URL containing `/runs/<id>` is treated as `runs_id`; any other valid Git ref/SHA string is treated as a commit/ref for checks. GitHub Actions workflow run URLs are not treated as check-run targets because they represent workflow runs, not the check-run ID currently owned by the server source.
