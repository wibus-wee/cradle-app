# Add durable Background Jobs and migrate Diff Review generation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This plan follows `/Users/wibus/.agents/skills/execplan/references/PLANS.md`; the repository does not contain a separate root `PLANS.md`.

## Purpose / Big Picture

After this change, server-owned long-running work can return from its HTTP request immediately while its lifecycle remains durable in SQLite. A generic Background Job module will expose pending, running, succeeded, failed, and cancelled state, reconcile jobs from their source of truth after a server restart, and let the owning product module project terminal results into its own tables. Cradle Diffs change walkthrough generation and commit-plan generation are the first consumers. A user can start either operation, poll the Diff Review or Background Job API, restart the server while the work is outstanding, and still observe a terminal domain state instead of a permanently stuck in-memory waiter.

## Progress

- [x] (2026-07-10 19:03Z) Read CR1-114, the repository instructions, the Cradle CLI workflow, server module conventions, and the ExecPlan requirements.
- [x] (2026-07-10 19:03Z) Located the two migration targets: `runGuideGenerationTask` and the `expectedOutput: "commit"` branch of `watchAgentFixRunCompletion`, both of which currently call `ChatRuntime.waitForRunCompletion` with an unbounded in-process waiter.
- [x] (2026-07-11 05:50Z) Added the persistent `background_jobs` model, additive migration 0029, and an idempotent agent-fix link for generated commit plans.
- [x] (2026-07-11 05:50Z) Added the Background Job service, registries, poller, API/CLI contracts, documentation, application lifecycle registration, and test-reset ownership.
- [x] (2026-07-11 05:50Z) Registered the Chat Runtime source adapter backed by `backend_runs`, including terminal mapping and source cancellation.
- [x] (2026-07-11 05:50Z) Migrated Diff Review guide and commit-plan generation to durable jobs and product-owned terminal projectors.
- [x] (2026-07-11 05:50Z) Preserved idempotent cancellation, run/status stale-write fences, target-revision validation, and idempotent commit-plan creation.
- [x] (2026-07-11 05:50Z) Added focused lifecycle, active-job restart, projection retry, cancellation race, and Diff Review integration coverage; 16 focused tests pass.
- [x] (2026-07-11 05:50Z) Regenerated migration and CLI artifacts; server typecheck, CLI typecheck/help, focused tests, and touched-file lint complete without errors.
- [x] (2026-07-11 05:59Z) Ran the complete server suite and audited the result: 957/962 tests pass; all five failures are in untouched model catalog/display-name expectations and are recorded for the PR.
- [x] (2026-07-11 06:03Z) Completed the final staged diff/whitespace review and committed the implementation with message `feat(server): add durable background jobs`.
- [ ] Push and create a detailed Draft PR through the Cradle session pull-request workflow.

## Surprises & Discoveries

- Observation: The HTTP routes already return immediately, but the work is not durable because feature code retains a Promise subscribed to an in-memory run subscriber for as long as 24 hours.
  Evidence: `apps/server/src/modules/diff-review/service.ts` calls `ChatRuntime.waitForRunCompletion(input.runId, { timeoutMs: null })` from both guide generation and agent-fix completion.

- Observation: Chat Runtime already persists the authoritative run state needed by a job source adapter.
  Evidence: `packages/db/src/schema/backend-control-plane.ts` defines `backend_runs.status` as `streaming`, `complete`, `aborted`, or `failed`, with terminal timestamps and error text; boot recovery repairs interrupted persisted projections.

- Observation: Diff Review already contains stale-write fences based on the active domain row's run and status, so the migration can strengthen those checks rather than inventing a compatibility layer.
  Evidence: guide completion verifies the current revision/input hash is still active, and agent-fix completion verifies the row still has the same `runId` and `running` status.

- Observation: The worktree initially lacked installed workspace dependencies, so the first server typecheck failed inside `@cradle/plugin-sdk` before reaching the changed server code.
  Evidence: `pnpm install --frozen-lockfile` restored the lockfile-defined dependency graph; the next `pnpm typecheck:server` completed successfully.

- Observation: The checked-in TypeScript style predates the current root Prettier settings, so running Prettier on existing large files created review-obscuring formatting churn.
  Evidence: the first formatted diff changed hundreds of unrelated lines. Those files were mechanically restored to `HEAD`, semantic patches were reapplied, and the final touched-file ESLint run reports zero errors.

## Decision Log

- Decision: The generic module will own job lifecycle persistence and polling, while product-specific projection callbacks remain defined and registered by the owning product module.
  Rationale: This obeys the repository's namespace rule. Background Job may read a registered source and invoke a callback, but it does not import or write Diff Review tables.
  Date/Author: 2026-07-10 / Codex

- Decision: Background Job will use source adapters and owner projectors instead of a switch statement over Diff Review job kinds.
  Rationale: The resulting API is reusable by future server modules and keeps both source semantics and domain projection extensible.
  Date/Author: 2026-07-10 / Codex

- Decision: Job cancellation will persist `cancelled` before asking the source adapter to abort work, and terminal reconciliation will only update pending or running jobs.
  Rationale: This makes cancellation idempotent and ensures a late source completion cannot overwrite a cancelled job. Diff Review projectors will retain their own run/status fences for the same guarantee in domain tables.
  Date/Author: 2026-07-10 / Codex

- Decision: Domain GET/list polling will request reconciliation for matching Diff Review jobs in addition to the periodic server poller.
  Rationale: Correctness still comes from durable periodic polling, while explicit polling produces prompt updates and keeps tests deterministic without creating per-request or per-job waiters.
  Date/Author: 2026-07-10 / Codex

## Outcomes & Retrospective

The reusable Background Job capability and both requested Diff Review migrations are implemented and committed. Focused validation proves durable active-job recovery across a database reopen, retry of a terminal but unprojected job, idempotent cancellation that ignores late success, and successful Guide/Commit Plan projection through real Chat Runtime-backed rows. The complete server suite passed 957 of 962 tests; the five failures are confined to untouched model registry/catalog expectations involving missing model entries or display-name casing. Draft PR delivery remains.

## Context and Orientation

Cradle's server lives under `apps/server/src`. Each capability is an Elysia module under `apps/server/src/modules/<domain>` with route contracts in `index.ts`, TypeBox schemas in `model.ts`, business semantics in `service.ts`, and an ownership inventory in `README.md`. The application composes modules in `apps/server/src/app.ts`.

Database tables are defined with Drizzle ORM under `packages/db/src/schema` and exported from `packages/db/src/schema/index.ts`. Runtime migrations live under `packages/db/drizzle`; they are generated with `pnpm --filter @cradle/db generate` and must be committed together with the SQL, metadata snapshot, and journal entry.

Chat Runtime persists each model/tool run in `backend_runs`, defined in `packages/db/src/schema/backend-control-plane.ts`. A run begins as `streaming` and ends as `complete`, `aborted`, or `failed`. The current `waitForRunCompletion` helper in `apps/server/src/modules/chat-runtime/stream/live-run-streams.ts` subscribes to an in-memory event registry. That helper is suitable for request-scoped waits but cannot recover a feature-owned Promise after the process restarts.

Diff Review owns generated walkthrough rows in `diff_review_guides` and agent work orders in `diff_review_agent_fixes`. Commit-plan generation is represented as an agent work order whose `expected_output` is `commit`; successful output is parsed and inserted into `diff_review_commit_plans`. The migration will leave parsing and table writes inside `apps/server/src/modules/diff-review/service.ts`.

A source adapter is a Background Job extension that reads the durable external or internal system that actually performs the work. The first adapter reads a Chat Runtime `backend_runs` row. An owner projector is a callback registered by a product module; it turns a terminal job observation into product-owned rows. Neither extension is an in-memory waiter: the registry describes behavior, while every outstanding instance remains a database row that the poller can rediscover.

## Plan of Work

First, add `packages/db/src/schema/background-job.ts` with a `background_jobs` table. The row will include a stable id; owner namespace, resource type, resource id, and optional resource key; a reusable job kind; pending/running/succeeded/failed/cancelled status; source kind plus session/run references; attempt count; JSON context, progress, result, and error details; cancellation, start, finish, projection, creation, and update timestamps; and projection retry information. Export it from the schema index and generate an additive migration.

Second, create `apps/server/src/modules/background-job`. `service.ts` will create, query, cancel, and reconcile jobs through registered source adapters and owner projectors. Terminal transitions will be persisted before projection so a crash between those steps leaves an unprojected terminal row that startup or periodic polling can retry. `poller.ts` will serialize reconciliation passes, recover active jobs, and retry terminal rows whose projection is incomplete. `sources/chat-runtime.ts` will map `backend_runs` into generic source observations and use Chat Runtime cancellation for an idempotent abort request. `model.ts` and `index.ts` will expose list, get, and cancel operations with generated CLI metadata. `README.md` will describe ownership and extension contracts.

Third, register the module in `apps/server/src/app.ts`. Its poller will start only when normal background tasks are enabled and will stop during shutdown. The Diff Review service will register two owner projectors, one for walkthroughs and one for commit plans. Starting those operations will create the Chat Runtime session and run as today, persist the domain `running` row, enqueue a Background Job referencing the same session/run, request reconciliation, and return immediately without calling `waitForRunCompletion`.

The guide projector will locate the current guide by run id, preserve the existing input-hash and active-status fence, translate failed or aborted runs into failed or cancelled guide state, and on success read the stored assistant message, parse the guide artifact, normalize anchors against the stored revision, and write `ready`. Parsing errors will produce a failed domain row and a failed final job result.

The commit-plan projector will locate the current agent fix by run id and require `expectedOutput: "commit"`, the same active run, and the target revision still owned by the review. It will translate source failure or abort into failed/cancelled work-order state. On success it will parse the artifact, create the product-owned commit plan, mark the work order complete, and record the existing domain events. Other agent-fix output modes will keep their current completion path in this issue.

Cancellation will find the active Background Job for the domain operation and cancel it through the generic service. The job row becomes cancelled before the Chat Runtime adapter asks the session to abort. The owner projector then marks the matching domain row cancelled. Repeated cancellation returns the same state, and all projectors compare source run and active domain status before writing.

Finally, add unit/integration coverage, update both module READMEs and the Drizzle migration inventory, regenerate CLI commands from OpenAPI, run formatting on touched files, and execute typecheck plus focused server tests. Inspect the final diff for ownership violations, raw SQL, dynamic workarounds, or missing documentation before creating the Draft PR.

## Concrete Steps

Run all commands from the repository root:

    /Users/wibus/Library/Application Support/@cradle/desktop/data/worktrees/bb3c1bce-55f8-4215-aa4b-c565e487eb3c/137f1858-cradle-issue-cr1-114-draft-pr

After editing the Drizzle schema, generate the migration:

    pnpm --filter @cradle/db generate

Expect one new numbered SQL migration, one matching metadata snapshot, and an appended `packages/db/drizzle/meta/_journal.json` entry.

After route metadata is complete, regenerate the CLI and verify its contract:

    pnpm gen:cli
    pnpm --filter @cradle/cli typecheck
    pnpm --filter @cradle/cli cradle --help

Run focused tests while implementing:

    pnpm --filter @cradle/server exec vitest run tests/background-job.test.ts tests/diff-review.test.ts

Run the server checks required by the module skill before delivery:

    pnpm typecheck:server
    pnpm test:server

Before the Draft PR, inspect the repository state through Cradle and the final patch with Git:

    cradle workspace git status --format json
    git diff --check
    git diff --stat origin/main...HEAD

Commit and deliver through the session-bound Draft PR workflow:

    git add <touched paths>
    git commit -m "feat(server): add durable background jobs"
    cradle session pull-request create --title "Add durable Background Jobs" --body "<summary and test plan>"

## Validation and Acceptance

Starting guide generation must return HTTP 200 with the guide already in `running` state and a durable active Background Job referencing the Chat Runtime session and run. No feature-owned call to `waitForRunCompletion` may remain for guide generation.

Starting an agent fix whose expected output is `commit` must return HTTP 200 with the work order in `running` state and a durable commit-plan Background Job. Completing the source run and reconciling jobs must create exactly one commit plan and mark the work order `completed`.

If an active source run becomes `failed`, the job must become `failed` and the matching guide or commit-plan work order must expose the error. If it becomes `aborted`, both job and domain state must become `cancelled`.

Stopping and starting the poller, or reconstructing the server around an existing active job row, must not lose the work. Once Chat Runtime boot recovery marks an interrupted run terminal, the next Background Job reconciliation must project a terminal domain state.

Calling cancel twice must succeed idempotently. If the source later reports completion, the job must remain cancelled and the matching domain row must not become ready/completed.

The Background Job list/get API and generated CLI commands must expose reusable job fields without Diff Review-specific response types. The Background Job module must not import Diff Review tables or services.

Focused tests, `pnpm typecheck:server`, and `pnpm test:server` must pass. Generated CLI typecheck and help rendering must pass after route metadata changes. `git diff --check` must report no whitespace errors.

## Idempotence and Recovery

Drizzle migration generation is additive and should be run once after the schema stabilizes. If the generated migration is wrong before commit, remove only the newly generated migration SQL, its matching snapshot, and its journal entry, then regenerate; never rewrite earlier migrations.

Job reconciliation is intentionally repeatable. Active jobs are updated only while pending or running. Terminal jobs are immutable except for their owner projection metadata and a possible owner-provided final status override after artifact validation. Projectors must check the current domain run and active status before writing, and creation of commit-plan artifacts must be guarded so repeating a projection cannot insert duplicates.

Poller start and stop are idempotent. A server restart requires no manual repair: Chat Runtime first reconciles persisted runs, then Background Job polling reads their durable terminal status and retries any unprojected terminal job.

Cancellation is safe to retry. The job status is committed first, the source abort is best effort and idempotent, and late source completion cannot transition a terminal job.

## Artifacts and Notes

Initial evidence from the old implementation:

    apps/server/src/modules/diff-review/service.ts:2225
      ChatRuntime.waitForRunCompletion(input.runId, { timeoutMs: null })

    apps/server/src/modules/diff-review/service.ts:2938
      ChatRuntime.waitForRunCompletion(input.runId, { timeoutMs: null })

The authoritative source table already records the required terminal facts:

    backend_runs.status = streaming | complete | aborted | failed
    backend_runs.error_text
    backend_runs.started_at
    backend_runs.finished_at

Implementation and validation transcripts will be added here as they become available.

    pnpm typecheck:server
      completed with exit code 0

    pnpm --filter @cradle/server exec vitest run tests/background-job.test.ts tests/diff-review.test.ts
      Test Files  2 passed (2)
      Tests       16 passed (16)

    pnpm --filter @cradle/cli typecheck
      completed with exit code 0

    pnpm --filter @cradle/cli cradle --help
      includes the generated `background-job` command group

    pnpm test:server
      Test Files  4 failed | 157 passed (161)
      Tests       5 failed | 957 passed (962)

      Unrelated failing areas:
      - tests/external-provider-sources.test.ts model list contents
      - tests/profiles.test.ts model list contents / upstream 502
      - src/modules/conversation-bridge/service.test.ts model display-name casing
      - src/modules/chat-runtime-providers/opencode/config.test.ts model display-name casing

## Interfaces and Dependencies

In `packages/db/src/schema/background-job.ts`, define and export `backgroundJobs`, `BackgroundJob`, and `NewBackgroundJob` using Drizzle SQLite APIs. No raw SQL access is permitted in server services.

In `apps/server/src/modules/background-job/types.ts`, define a source observation with pending, running, succeeded, failed, or cancelled status and optional progress, result, error code, message, and details. Define a source adapter with a stable `sourceKind`, a `read(job)` method, and an optional `cancel(job)` method. Define an owner projector keyed by `ownerNamespace` and `kind` whose terminal projection can optionally override the provisional terminal status and result/error metadata after domain artifact validation.

In `apps/server/src/modules/background-job/service.ts`, provide stable functions equivalent to:

    registerSourceAdapter(adapter): void
    registerOwnerProjector(projector): void
    enqueue(input): BackgroundJobView
    get(id): BackgroundJobView
    list(filters): BackgroundJobView[]
    reconcile(filters?): Promise<void>
    cancel(id): Promise<BackgroundJobView>

In `apps/server/src/modules/background-job/poller.ts`, provide idempotent `start`, `stop`, `requestRun`, and `runOnce` functions. The poller may use a bounded concurrency helper but must not create one subscriber or waiter per job.

In `apps/server/src/modules/background-job/sources/chat-runtime.ts`, use the existing `backendRuns` Drizzle table as the source of truth and `ChatRuntime.cancelSession` for cancellation. Do not use `waitForRunCompletion`.

In `apps/server/src/modules/diff-review/service.ts`, register `diff-review` projectors and enqueue `guide-generation` and `commit-plan-generation` jobs. Parsing, normalization, event creation, and writes to `diff_review_*` tables remain owned by this file.

Revision note (2026-07-10 19:03Z): Created the initial self-contained implementation plan after repository and issue analysis. The design deliberately separates generic durable lifecycle ownership from product-owned result projection.

Revision note (2026-07-11 05:50Z): Recorded the completed schema/runtime/migration work, both Diff Review migrations, focused validation evidence, dependency setup, and the formatting-churn recovery. Remaining work is the full server suite, final review, commit, and Draft PR delivery.

Revision note (2026-07-11 05:59Z): Added the complete server-suite result and isolated its five failures to untouched, externally influenced model catalog/display-name expectations.

Revision note (2026-07-11 06:03Z): Recorded final diff validation and the implementation commit. Only session-bound Draft PR creation remains.
