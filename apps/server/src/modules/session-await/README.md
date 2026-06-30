# Session Await Module

`session-await` owns durable waits that can resume an existing chat session when an external condition becomes true. The module owns await lifecycle, polling, cancellation, manual trigger, summary projection, source adapter registration, source failure classification, and delivery retry. Matched awaits dispatch into Chat Runtime's durable continuation queue so busy sessions still receive the wake-up message.

## Files

- **index.ts**: Elysia routes under `/session-awaits`, poller startup, registration wake-up, live status dispatch for supported sources, and CLI metadata for create/list/get/cancel/trigger/retry/summary routes.
- **model.ts**: TypeBox request/response schemas for create, list, get, cancel, trigger, delivery retry, and summary routes.
- **service.ts**: Durable await writes, supported-source validation, GitHub target preflight validation, available-checks error normalization, pending queries, idempotent trigger handling, delivery failure marking, retry delivery, and chat runtime queue dispatch for resume messages.
- **poller.ts**: Source registry, explicit single-cycle runner, immediate run requests, interval tick, expiry handling, timer awaits, source checks, empty resume guard, permanent source failure handling, and bounded trigger concurrency.
- **types.ts**: Source adapter and await lifecycle TypeScript contracts; matched source results must carry non-empty resume text.
- **../../lib/github-api.ts**: Shared GitHub REST API boundary, token resolution, ETag cache, rate-limit tracking, missing-target classification, PR/check/status/review/workflow-run/workflow-job fetch helpers. Session await and external issue source refresh both consume this host-owned GitHub access boundary.
- **sources/github-ci.ts**: `github-ci` source. Supports `{ repo, pr }`, `{ repo, sha }`, and `{ repo, runs_id }` filters, validates target visibility during registration, resolves PR head SHAs or single check-run head SHAs, aggregates check runs plus legacy commit statuses, and exposes live CI status with optional GitHub Actions job steps.
- **sources/github-review.ts**: `github-review` source. Supports `{ repo, pr, mode }` filters, validates PR visibility during registration, and waits for PR review signals on the current PR head.

## GitHub Sources

`github-ci` waits for all visible check runs and commit statuses on the resolved ref to complete. A CI filter must target exactly one of `{ pr }`, `{ sha }`, or `{ runs_id }`. With `{ repo, runs_id }`, it waits only for that GitHub check run ID and does not fold in sibling checks or legacy statuses from the same commit. It treats `success`, `neutral`, and `skipped` check conclusions as passing; `success` commit statuses as passing; pending signals as still pending; and any failure/error/cancelled/action-required signal as a completed failure. If no checks or statuses appear, it waits for `allowNoChecksAfterSeconds` or the default grace period before resuming with `noCIConfigured`.

GitHub await creation performs a read-only preflight against the target repo plus PR or commit. GitHub 404 and 422 responses are treated as non-retryable missing or inaccessible targets, so the create route returns `github_await_target_invalid` instead of registering an await that would poll forever. Other GitHub API failures return `github_await_validation_unavailable` and do not create the await. Existing pending awaits use the same missing-target classification in the poller and live-status route, then move to `failed` rather than remaining pending indefinitely.

The `github-ci` live-status route also reads GitHub Actions workflow runs for the resolved head SHA and projects workflow jobs plus job steps when available. This is a read-only display enhancement: await completion remains owned by the check-run and commit-status aggregate so legacy status contexts and branch-protection-facing checks stay part of the decision.

`github-review` waits for PR review state on the PR head SHA. Modes are:

- `approved`: at least one current-head approval and no current-head changes-requested review.
- `changes-requested`: at least one current-head changes-requested review.
- `reviewed`: any current-head submitted review signal.

These sources intentionally do not claim exact branch-protection equivalence. Required checks, required review counts, code owners, stale dismissal rules, and rulesets need separate GitHub permissions and should be modeled as a later source or explicit mode.

Bypass rules are only for non-required CI signals. Required GitHub branch-protection contexts remain part of the aggregate even when a per-await bypass or workspace bypass glob would otherwise match their names.

## Cradle Issue Sources

`cradle-issue-agent` waits for delegated Issue Agent work to return. Callers register the await with issue IDs and the source resolves each issue's current delegation to an Agent Interaction Runtime `agentSessionId` at registration time. The stored filter keeps that resolved snapshot so later reruns or new delegations do not change what the await is waiting for. The source matches when every resolved agent session reaches a terminal status: `completed`, `failed`, or `stopped`. Worker failure and stop are successful await matches because the parent chat session needs to resume and decide how to handle the worker result; they are not `session_await.failed` source failures.

`cradle-issue-status` waits for Issue-owned workflow status. It accepts issue IDs, `all` or `any` mode, and one target family: status categories, status IDs, or status names. Status names are resolved to status IDs when the await is registered. The source matches when the requested issues reach the target condition. This source is for business workflow completion such as waiting for an issue to enter the `completed` category, not for waiting on a specific worker execution attempt.

Both issue sources are Cradle-internal source names because `session_awaits.source` is global. They read Issue, Issue Agent, and Agent Interaction Runtime state, but they do not write those namespaces. Cancelling a pending issue await only stops waiting in the parent chat session; it does not stop issue-agent worker sessions, clear issue delegation, or move issue statuses. Stop workers through Issue Agent APIs and move issues through Issue APIs.

## Failure Semantics

Source failures and delivery failures are intentionally separate:

- `failureKind: "source"` means the external source cannot complete the await, such as a missing GitHub target. These records are terminal and cannot use delivery retry.
- `failureKind: "delivery"` means the source matched, but enqueueing the resume message into Chat Runtime failed. The row keeps `resumeText` and optional `resumePayloadJson`, so `POST /session-awaits/:id/retry-delivery` can enqueue the same result without polling the external source again.
- Unknown `source` values are rejected at registration. `manual` awaits are explicit trigger-only records, and `timer` awaits require `fireAt`.
- A trigger, delivery retry, or source adapter match must provide non-blank resume text. Blank source results are treated as source failures instead of delivering empty chat messages.
