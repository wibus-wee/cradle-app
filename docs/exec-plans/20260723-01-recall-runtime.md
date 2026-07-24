# Deliver Cradle Recall as explicit, evidence-backed agent retrieval

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. It follows the repository's ExecPlan requirements in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`.

## Purpose / Big Picture

Agents need a way to investigate prior work without silently receiving old conversations in every turn. After this work, an agent can explicitly call one `recall_query` capability, receive compact JSON evidence from the current workspace, inspect a message, run, failure, or file-touch history, and distinguish that evidence from a prior durable memory. A future approval flow can use the separately bounded `recall_attune` capability to save conclusions with evidence anchors. The architecture must leave the stable harness and transcript unchanged: recall appears only at the tool-result tail.

## Progress

- [x] (2026-07-22 17:00Z) Read the Phase A cognition plan, retrieval contract, capability specification, current database schema, chat event projector, search module, evaluator, and agent MCP registration.
- [x] (2026-07-22 17:00Z) Confirm that Phase A is already merged by commit `22752ff3` and that Plan 050/051 remain unfinished.
- [x] (2026-07-22 17:00Z) Identified the missing runtime-bound caller context needed for a correct `recall_query(code)` agent interface.
- [x] (2026-07-22 17:04Z) Recorded the invocation-authority requirement in the cognition plan, agent contract, capability spec, and plan status row.
- [ ] Add the Recall owner module and public read/query boundary, without granting cross-namespace writes.
- [ ] Add the append-only `recall_*` Drizzle read model, migration, synchronous chat/run projectors, and deterministic backfill.
- [ ] Add the managed-process CodeAct query execution path, helper contract tests, and an agent integration that derives scope from trusted runtime context.
- [ ] Add the separately approved attune mutation capability and its evidence-anchor retention model.
- [ ] Promote the retrieval contract to `.agents/skills/recall/SKILL.md`, update capability/status documentation, run focused and server verification, and deliver a draft PR.

## Surprises & Discoveries

- Observation: `plans/061-cradle-recall-agent-cognition-stack.md` says Phase A must merge before Phase B. It is already in the history at `22752ff3`; the capability spec still accurately marks runtime implementation as not started.
  Evidence: `git log -- plans/061-recall-retrieval-contract.md` includes `22752ff3 docs(recall): Plan 061 — Cradle Recall agent cognition stack (Phase A) (#67)`.
- Observation: the only installed generic agent MCP tool is `manage_pull_request`, and its process is registered once with only server URL/auth environment. It receives no per-turn session identity.
  Evidence: `apps/server/src/modules/agent-tools/runtime-registration.ts` passes only `CRADLE_SERVER_URL` and `CRADLE_AUTH_TOKEN`; `apps/server/src/modules/agent-tools/tools/index.ts` registers only the Work delivery tool.
- Observation: arbitrary JavaScript evaluation is reliability-isolated but explicitly is not a security sandbox. It must never be used as the source of authorization.
  Evidence: `apps/server/src/modules/javascript-eval/README.md` states that a cell inherits server-process filesystem, network, and command authority.

## Decision Log

- Decision: Preserve `recall_query(code)` as the agent-facing primitive, but require the provider runtime to bind an immutable recall invocation context before it reaches the Recall owner.
  Rationale: accepting a caller-supplied `workspaceId` as the source of default scope lets an agent widen its authority by construction, while the generic MCP process cannot infer the caller session. The capability context carries session/workspace identity; helper options may only narrow it.
  Date/Author: 2026-07-22 / Codex
- Decision: Do not begin implementation of issue filtering until Plan 051 owns issue/execution associations. Work and session filters remain optional narrowing filters only after their owner APIs can prove them.
  Rationale: Recall facts must be scope-correct. Empty valid results are acceptable; false-positive evidence from a stale association is not.
  Date/Author: 2026-07-22 / Codex
- Decision: Keep Phase B query delivery independent from attune writes. `recall_attune` will have a distinct route, evaluator mode, approval credential, and registry rather than sharing a mutable query sandbox.
  Rationale: a retrieval query is read-only and can be retried; durable synthesis is an auditable user-approved mutation with different authority and retention semantics.
  Date/Author: 2026-07-22 / Codex

## Outcomes & Retrospective

Implementation is not complete. The initial investigation established that the existing documents have the correct cognition layering, but a runtime-bound invocation context is required before the documented one-argument Agent interface can be honest and safe. The remaining milestones implement that boundary before query behavior is exposed.

## Context and Orientation

Recall is Layer 3, the explicit retrieval layer, in Cradle's five-layer cognition model. Layer 1 is immutable execution evidence: completed chat messages and terminal run snapshots. Layer 2 is curated memory, such as Chronicle records and future approved attune records. Layer 4 is the normal harness/transcript assembly. It is deliberately unchanged by this work. Layer 5 owns Work, Issue, Queue, and automation routing; those objects orient a query but do not silently reduce its workspace scope.

`apps/server/src/modules/recall` will own the Layer 3 contract. Its `public.ts` is the only cross-module read/query seam. It may read through exported owner APIs from chat-runtime, session, work, and Chronicle; it must not insert into their tables. Its own `recall_*` tables are projections, meaning disposable derived rows that can be rebuilt from Layer 1 facts.

The source evidence lives in `packages/db/src/schema/chat.ts` (`sessions`, `messages`, and `chat_message_payloads`) and `packages/db/src/schema/backend-control-plane.ts` (`backend_run_snapshots` and `backend_run_snapshot_events`). Chat Runtime's synchronous event projection is in `apps/server/src/modules/chat-runtime/es/projectors.ts`. The existing human `modules/search/thread-search.engine.ts` is an FTS façade and is not the Agent tool implementation. `modules/javascript-eval` supplies managed Node-process lifecycle and result limits, but does not provide authorization or filesystem isolation.

## Plan of Work

First define a typed `RecallInvocationContext` that is created by the provider runtime from the active chat session and never accepted from JavaScript or MCP tool parameters. It contains the calling session, workspace, optional verified Work identity, and an approval grant when the user approved a specific attune operation. The query tool takes only source code; the runtime transmits the invocation context over an authenticated internal boundary. Scope defaults to the context workspace. `sessionId`, `workId`, and `issueId` helper options are checked as narrowing filters against that context and owner APIs.

Next introduce `recall_messages`, `recall_tool_calls`, `recall_tool_results`, and `recall_runs` schemas under `packages/db/src/schema/recall.ts`, export them through the DB schema index, and create an additive migration. Every row records stable upstream identifiers, workspace/session IDs, timestamps, sidechain/meta flags, and a bounded searchable excerpt. The migration also creates FTS over recall's own text, not the legacy `messages_fts` table. The Recall projector consumes complete message and terminal run events synchronously. A repeatable backfill rebuilds all Recall rows transactionally from the source tables. Session removal cascades from the source foreign keys; archive filters evidence instead of deleting it unless retention requires purge.

Then implement helpers as internal functions in `modules/recall/query-service.ts`: `overview`, `search`, `context`, `thread`, `failures`, `fileHistory`, `runs`, and `memories`. Each helper clamps limits and response excerpt sizes, excludes meta rows and sidechains unless explicitly requested, and returns stable IDs. `sql` is postponed until a narrow read-only parser can prove a single SELECT/WITH statement with no SQLite mutation pragma or attached database behavior; a string-prefix check is insufficient.

The CodeAct execution adapter runs in a disposable managed Node process and injects only frozen helper client functions plus the trusted context. It returns JSON only. It cannot use agent-provided scope to authorize a wider query. The public HTTP route is a server-to-runtime contract, not a generic user route; if a CLI is later added, it requires an explicit workspace and acts as a distinct human-facing authorization path. The generic shared MCP server is not a correct place to register Recall until its process protocol can bind a real calling session.

Finally add a separate attune registry with evidence anchors and archived forgetting. The API requires an approval grant issued for the proposed mutation. It stores a concise conclusion plus anchors, never modifies Layer 1 evidence, and exposes these records through `memories()` beside Chronicle's public memory view. Promote the contract into an installed Recall skill only when the agent can actually invoke the query capability.

## Concrete Steps

Work from the repository root.

1. Add `packages/db/src/schema/recall.ts`, export it from `packages/db/src/schema/index.ts`, then run `pnpm --filter @cradle/db generate`. Inspect the generated SQL and metadata before keeping it. Expected result: one new additive migration creating only `recall_*` relations and FTS support.
2. Add `apps/server/src/modules/recall/{index.ts,model.ts,service.ts,query-service.ts,public.ts,README.md}` and focused unit tests. Mount the module in `apps/server/src/app.ts`. The first query route must reject an absent trusted invocation context rather than trusting arbitrary `workspaceId` input.
3. Add synchronous Recall projection calls at the completed-message, rollback, run-terminal, archive, and delete lifecycle points. Add a deterministic backfill entrypoint that can run twice without duplicate rows.
4. Extend the managed evaluator using a typed runner protocol rather than copied process management. Its Recall runner receives immutable context and server-supplied helpers; it must reject non-JSON output and respect existing source, timeout, and result-size limits.
5. Add contract fixtures that exercise default workspace scope, session narrowing, valid empty results, sidechain/meta exclusion, failure/file history, evidence/memory distinction, and forbidden mutation. Add a regression assertion that no Recall source is registered by `chat-runtime/harness/context-source-registry.ts`.
6. When a provider-level invocation-context transport exists, register exactly one `recall_query` on each agent-capable runtime. Add `recall_attune` only with the approval grant path. Copy the final agent usage contract to `.agents/skills/recall/SKILL.md`.
7. Run `pnpm --filter @cradle/server exec vitest run <recall focused files>`, `pnpm typecheck:server`, and the relevant database migration test. Update this plan with actual command output before committing.

## Validation and Acceptance

The completed query test creates two workspaces and several sessions. A query invoked from workspace A searches a term present in both workspaces and returns only stable evidence IDs from A. Calling `thread` with a different workspace's session returns a typed scope error; a valid session with no evidence returns an empty array. A query for a completed failing tool returns its run and tool-result IDs. A meta steer message and a sidechain message do not appear unless the corresponding opt-in is passed.

The evaluator tests must demonstrate that a query program can call `overview()` and `search()` and receives JSON, while a program attempting a mutation helper, non-SELECT SQL, or an oversized result fails with a typed error. The harness guard must show no Recall registration. Attune tests must demonstrate that a missing or mismatched approval grant cannot create a record, and that `forget()` archives rather than erases its evidence anchors.

## Idempotence and Recovery

All schema work is additive. The backfill deletes and recreates only Recall-owner projection rows inside a transaction, so rerunning it after an interrupted process is safe. Source message/run evidence remains untouched. A failed migration is retried through the normal Drizzle migration lifecycle; never edit an already-applied migration. If scope ownership cannot be proven by the active runtime, leave the agent tool unregistered and retain the tested server query core rather than shipping a caller-controlled default scope.

## Artifacts and Notes

The current repository has two important architectural facts:

    Phase A merged: 22752ff3 docs(recall): Plan 061 — Cradle Recall agent cognition stack (Phase A) (#67)
    Generic MCP registration environment: CRADLE_SERVER_URL and optional CRADLE_AUTH_TOKEN only

These facts require provider-runtime context binding for `recall_query(code)`. They do not justify adding Recall to a harness fragment or adding one MCP tool per helper.

## Interfaces and Dependencies

`apps/server/src/modules/recall/public.ts` must expose a narrow entry point equivalent to:

    export interface RecallInvocationContext {
      chatSessionId: string
      workspaceId: string
      workId: string | null
      approvalGrantId: string | null
    }

    export async function executeRecallQuery(input: {
      context: RecallInvocationContext
      code: string
    }): Promise<RecallQueryResult>

The context is created by trusted runtime code, not decoded from Agent JavaScript. `RecallQueryResult` is JSON-compatible and bounded. The query helpers are private to the Recall execution environment. Chronicle exposes durable records through its public read seam; its tables are not read or written directly by Recall. Chat Runtime invokes `ingestMessage` and `ingestRun` through Recall's public seam after source facts become durable.

Revision note (2026-07-22): Created after architecture inspection to capture the missing caller-context boundary before implementation begins. Updated after the boundary was incorporated into the Phase B contract and capability status.
