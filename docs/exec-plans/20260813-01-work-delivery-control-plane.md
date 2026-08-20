# Make Work an explainable delivery control plane

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This plan follows `/root/.codex/skills/remote-skills/skill-6a7c99a29154819197ed9ef537bc70b1/references/PLANS.md` because the repository does not contain its own `PLANS.md`.

## Purpose / Big Picture

After this change, a person using Cradle can open any Work and see one trustworthy delivery state, why Cradle chose that state, which signal had authority, who can move it forward, and what action comes next. The Work header also shows whether the run is merely live, can be resumed from provider state, can be restored from Cradle data, or can be reproduced from its managed checkout. A global Needs me surface collects human approvals, failed Work, review decisions, and merge or archive actions without requiring the user to inspect terminals one by one.

This is the complete P0 vertical slice from the supplied 0--30 day roadmap. The later runbook, Evidence Pack, delegation, machine sharing, and scheduled recipe slices remain deliberately outside this change because their correctness depends on the state and attention contracts implemented here. The accompanying LaTeX and TikZ report will evaluate this P0 slice with executable evidence and describe the measured boundary for the next phases.

## Progress

- [x] (2026-08-13 01:30+09:00) Confirmed the remote repository, created branch `agent/work-delivery-control-plane`, read repository guidance, and mapped the existing Work, Session, Worktree, Await, provider-runtime, desktop and web navigation owners.
- [x] (2026-08-13 01:36+09:00) Chose an additive derived-state architecture that does not duplicate runtime facts or require a speculative persisted event log.
- [x] (2026-08-13 02:31+09:00) Implemented server-side explainable Work state, authority, recovery promise, attention items, redetection, and persisted acceptance criteria.
- [x] (2026-08-13 02:48+09:00) Regenerated API clients and added fixture-driven Work badges, Needs me, and New Work acceptance criteria UI.
- [x] (2026-08-13 03:24+09:00) Added 44 focused server assertions, 40 focused web assertions, and a 16-step real-browser Work journey.
- [x] (2026-08-13 03:52+09:00) Installed dependencies, built plugins, synced Codex runtime, passed focused checks and target dogfood, and attempted the full active E2E suite twice. The outer environment cancelled network approval at native Codex startup; an existing cross-scenario Claude Read race also reproduced. Both limitations are retained as evidence rather than reported as success.
- [x] (2026-08-13 04:02+09:00) Produced, compiled, rendered, and visually inspected the four-page LaTeX + TikZ evaluation report.
- [x] (2026-08-13 04:08+09:00) Inspected the final diff and secret scan, confirmed the branch is based on current `origin/main`, compiled the final report, and prepared the intentional commit and Draft PR against `wibus-wee/cradle-app:main`.

## Surprises & Discoveries

- Observation: Cradle already has a Work aggregate and a genuine Work E2E journey, but `apps/server/src/modules/work/README.md` explicitly states that no Work status machine exists and stores only four coarse activity labels.
  Evidence: `apps/server/src/modules/work/service.ts` derives only `idle`, `running`, `waiting`, and `blocked` from Session, Worktree, Await, and pending interaction facts.

- Observation: The old `/awaits` surface is close to an attention inbox but contains only external Await records, while pending structured user input and tool approvals live in Chat Runtime and review/merge actions live in Work and Pull Request.
  Evidence: `apps/server/src/modules/desktop/service.ts#getDesktopAwaits` reads only `sessionAwaits`, although the same module already exposes runtime user-input requests separately.

- Observation: Provider resumability already has a single owner and durable binding predicate.
  Evidence: `apps/server/src/modules/provider-runtime/service.ts#readDurableProviderRuntimeBinding` is the correct source for the Resumable promise; Work must read it instead of reinterpreting provider fields.

- Observation: The hardened environment blocks the Playwright CDN but permits npm registry artifacts; Chromium 149 and system ffmpeg can satisfy Playwright without weakening browser assertions.
  Evidence: A standalone Playwright launch rendered `real browser`, and `@CRADLE-WORK-001` then passed all 16 steps against the production Vite bundle.

- Observation: The repository's active suite has an existing cross-scenario Claude Read race and native Codex startup requires an outer network approval not granted in this environment.
  Evidence: `@CRADLE-AGENT-004` passed 12/12 alone but failed after approval scenarios because no activity feed appeared; two monolithic P0/P1 runs were terminated when the outer sandbox cancelled network approval at Codex startup.

- Observation: Full server tests expose environment and pre-existing contract failures outside the Work slice.
  Evidence: 1711 tests passed, 2 skipped, and 9 failed. Failures include root refusal of Claude dangerous bypass, missing Go/relayd, a non-existent `/root/Documents/Cradle`, and existing Codex snapshot/continuation assertions; all new Work tests passed.

## Decision Log

- Decision: Deliver the roadmap's P0 0--30 day vertical slice in this PR and use the evaluation report to gate P1/P2 rather than implementing nominal, unvalidated versions of all 90-day slices at once.
  Rationale: Runbook resource locks, Evidence Pack gates, delegation limits, and machine permissions depend on a stable Work state and attention contract. Shipping them simultaneously would prevent meaningful dogfood attribution and violate the roadmap's own sequencing.
  Date/Author: 2026-08-13 / Codex

- Decision: Make Work state an explainable projection of authoritative owner facts, not a manually mutable `status` column.
  Rationale: Session, Chat Runtime, Worktree, Await, provider runtime, and Pull Request already own the facts. A second stored status would drift during crashes and reconnects. The projection remains event-driven because those owners update on structured runtime, Await, Git, and user events; redetection simply re-reads them.
  Date/Author: 2026-08-13 / Codex

- Decision: Keep the `/awaits` route identifier for navigation compatibility while turning its user-visible surface into Needs me backed by the Work attention contract.
  Rationale: Existing desktop actions and persisted surface tabs refer to `/awaits`. Reusing the route avoids breaking deep links while replacing the incomplete projection.
  Date/Author: 2026-08-13 / Codex

- Decision: Treat Recovery as a promise with a level plus evidence and timestamp, not as four independent booleans.
  Rationale: The labels are ordered guarantees. Showing the highest supportable level prevents contradictory combinations and lets the UI explain exactly which durable fact supports it.
  Date/Author: 2026-08-13 / Codex

## Outcomes & Retrospective

The P0 slice is complete. Work now composes canonical owner facts into one state, one explanation, one strongest recovery promise, and four attention categories. Acceptance criteria survive the database/API round trip and appear in the delivery UI. The target production-browser dogfood passed 1 scenario and 16/16 steps in 69.121 seconds, independently verifying the managed checkout and written file, API persistence, rendered badges, direct Needs me navigation, and simulator exhaustion.

Focused validation is green: 44 server assertions across two files, 40 web assertions across 14 files, server and web typechecks, module boundaries, changed-file lint, and the production web build. The full server run was mostly green (1711 passed) but remains non-green for nine unrelated environment/existing failures. The full P0/P1 Cucumber command was attempted twice but is inconclusive because the outer sandbox cancelled native Codex network approval; a known Claude Read isolation race is separately documented and passes in isolation.

The roadmap's fleet percentages are not claimed from one sample. The report explicitly gates them on one week of labeled Work observations, startup latency telemetry, restart cohorts, and a state confusion matrix. P1/P2 remain gated as planned.

## Context and Orientation

`packages/db/src/schema/work.ts` persists a Work objective and its relationship to a primary Session. `apps/server/src/modules/work/service.ts` composes the Session, managed Worktree, pull request readiness, Await summary, and Chat Runtime pending interaction into a Work response. It currently exposes only a four-value activity label. `apps/server/src/modules/work/model.ts` owns the HTTP schema and `apps/server/src/modules/work/index.ts` owns the `/works` routes.

The Session owner is `apps/server/src/modules/session/service.ts`. Chat Runtime owns active runs and pending user interactions under `apps/server/src/modules/chat-runtime/`. The managed checkout owner is `apps/server/src/modules/worktree/service.ts`. Durable provider resumability is owned by `apps/server/src/modules/provider-runtime/service.ts`. Pull Request readiness and live state are owned by `apps/server/src/modules/pull-request/service.ts`. Work will read these modules and will not copy their persistence or lifecycle logic.

On the web, `apps/web/src/features/work/` owns Work queries and fixture-driven surfaces. `apps/web/src/features/workspace/workspace-sidebar-navigation-view.tsx` owns primary navigation. The existing `/awaits` route renders `apps/web/src/features/session-await/awaits-overview.tsx`; it will become the compatible route for the Needs me projection. API clients under `apps/web/src/api-gen/` are generated from the server OpenAPI contract and must not be edited by hand.

A Work delivery state is the current phase of the delivery lifecycle. A state explanation names the triggering fact, evidence, authority, responsible actor, and next action. Authority is the provenance of the fact, ordered as structured owner data, runtime integration, terminal recognition, user override, then derived fallback. Recovery is the highest promise Cradle can truthfully make: Live, Resumable, Restorable, Reproducible, or Unknown.

## Plan of Work

First, extend the Work server contract with stable `WorkDeliveryState`, `WorkStateExplanation`, `WorkRecovery`, and `WorkAttentionItem` interfaces. Implement a pure state derivation function with explicit precedence and tests. The live aggregate read will gather its owner facts once, derive the projection, and expose it on both summary and detail responses. A `/works/attention` route will return only actionable Work items, sorted by risk and waiting time. A `/works/:id/redetect` route will perform a fresh read and return the same canonical detail; it does not mutate a status because no duplicate status exists.

Second, regenerate the web API client. Extend the pure Work header view with a recovery badge and a state explanation tooltip. Replace the `/awaits` page's data source and rendering with a pure Needs me view containing action category, Work, provider, reason, duration, risk, authority and next action. Add the route to primary navigation while retaining the route identity for compatibility. Fixtures and stories will contain complete typed examples.

Third, add focused server tests for every state precedence, authority explanation, recovery level, attention category and sorting rule. Add web tests that assert the badge and direct navigation action. Extend `e2e/src/features/work.feature` with a scenario that creates a real isolated Work, observes Running, completes the simulator run, and reaches the appropriate human review action without searching another screen.

Finally, install the pinned workspace dependencies, generate clients, run server boundaries/typecheck/tests, web typecheck/tests/build, and the full `@P0 or @P1` Cucumber suite. Dogfood will start a local server and web app with the model API simulator, create a Work through the UI, and capture the API/UI observations needed for the report. The LaTeX report under `docs/reports/` will use TikZ to show the fact owners, state projection, recovery lattice, attention routing, validation results, and explicit P1/P2 gates. It will be compiled to PDF when a TeX engine is available.

## Concrete Steps

All commands run from the repository root `/workspace/scratch/bd0f95f15417/cradle-app-remote`.

Install exact lockfile dependencies:

    pnpm install --frozen-lockfile

Generate web contracts after changing server routes:

    pnpm generate:web

Run focused validation during implementation:

    pnpm --filter @cradle/plugin-sdk build
    pnpm --filter @cradle/server typecheck
    pnpm --filter @cradle/server check:boundaries
    pnpm --filter @cradle/server test -- work/service.test.ts
    pnpm --filter @cradle/web typecheck
    pnpm exec vitest run apps/web/src/features/work apps/web/src/features/session-await

Run the authorized active E2E suite after focused validation:

    pnpm --filter @cradle/desktop sync:codex-runtime
    pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@P0 or @P1"

Compile the report if `latexmk` is present:

    latexmk -pdf -interaction=nonstopmode -halt-on-error docs/reports/work-delivery-control-plane-evaluation.tex

## Validation and Acceptance

The server state derivation tests must prove that archived, failed, unhealthy isolation, pending human interaction, external dependency Await, active runtime, ready pull request, merged pull request, and unknown facts select exactly one state with a matching explanation and authority. Recovery tests must prove Live when an active run exists, Resumable when a durable provider binding exists, Restorable when the Cradle Session persists, Reproducible when a healthy managed Worktree and base ref exist, and Unknown only when these facts cannot support a promise.

Opening a Work must visibly show a delivery state and one recovery badge. Hovering or focusing the state must expose why it was selected and the next action. Opening Needs me must list pending approval/answer, failure handling, review, and merge/archive items, ordered with high-risk long-waiting items first. Clicking an item must open its Work directly. Empty and server-error states must remain usable and explicit.

The E2E scenario passes only if the simulator exchange is exhausted, the Work is backed by a real managed worktree, and the user reaches the direct review action from Needs me. Agent self-report is not accepted as evidence; assertions use HTTP state, rendered DOM, the managed checkout, and process exit codes.

## Idempotence and Recovery

All state and attention reads are pure projections and can be retried without mutation. Redetection is deliberately a fresh read, so repeated clicks cannot corrupt Work state. Generated clients can be regenerated safely from the same server contract. Dependency installation uses the lockfile. If E2E setup fails midway, its existing support cleanup removes test processes and artifacts can be inspected under `e2e/artifacts/` before rerunning the same tags.

The branch is isolated from other workspace copies. No unrelated user changes were present when it was created. Publishing will stage explicit paths after a final status and diff review. The PR remains Draft by default.

## Artifacts and Notes

Initial repository evidence:

    d40f895e feat: add resource ticket API and update WebSocket ticket handling
    branch: agent/work-delivery-control-plane
    existing Work invariant: "Work stores facts only. Activity labels are derived and no Work status machine exists."

Completed artifacts:

    docs/reports/work-delivery-control-plane-evaluation.tex
    docs/reports/work-delivery-control-plane-evaluation.pdf

Key validation transcripts:

    Work dogfood: 1 scenario (1 passed), 16 steps (16 passed), 1m09.121s
    Focused server: 2 files passed, 44 tests passed
    Focused web: 14 files passed, 40 tests passed
    Full server: 295 files passed, 1 skipped, 5 failed; 1711 tests passed, 2 skipped, 9 failed

## Interfaces and Dependencies

`apps/server/src/modules/work/service.ts` will export these concepts with readonly string unions rather than mutable enums:

    type WorkDeliveryState =
      | 'draft' | 'queued' | 'preparing' | 'running'
      | 'awaiting_human' | 'awaiting_dependency' | 'verifying'
      | 'ready_for_review' | 'merging' | 'done' | 'failed'
      | 'cancelled' | 'archived' | 'unknown'

    type WorkStateAuthority =
      | 'official_hook' | 'runtime_integration' | 'terminal_recognizer'
      | 'user_override' | 'derived'

    type WorkRecoveryLevel =
      | 'live' | 'resumable' | 'restorable' | 'reproducible' | 'unknown'

    interface WorkStateExplanation {
      trigger: string
      evidence: string
      authority: WorkStateAuthority
      responsible: 'user' | 'agent' | 'dependency' | 'system'
      nextAction: string
      observedAt: number
    }

    interface WorkRecovery {
      level: WorkRecoveryLevel
      evidence: string
      lastHeartbeatAt: number | null
    }

The implementation may add owner-specific facts to these interfaces when tests demonstrate a user-visible need, but it must not add a writeable status field or inspect provider-private state. It will reuse existing dependencies only: Elysia/TypeBox, Drizzle owner reads, TanStack Query, the design system, Vitest, Cucumber and Playwright.

Revision note 2026-08-13: Initial plan created after repository orientation and scope selection. It records the complete P0 slice and explicitly gates later roadmap phases on measured P0 behavior.

Revision note 2026-08-13: Updated after implementation, browser dogfood, full-suite attempts, report compilation, and visual PDF QA. The non-green environment and existing-suite results are recorded as limits rather than hidden.
