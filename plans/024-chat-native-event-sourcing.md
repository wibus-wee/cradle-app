# Plan 024 — Rebuild the chat core on native Event Sourcing

> **Executor instructions**: Follow milestones in order; verify each. Honor STOP conditions and the M3 decision checkpoint. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 02146b4..HEAD -- apps/server/src/modules/chat-runtime/es apps/server/src/modules/chat-runtime/stream packages/db/src/schema/chat.ts` — mismatch = STOP and re-audit the current state section before editing.

## Status

- **Priority**: P2
- **Effort**: XL (split across 6 milestones; each milestone is independently shippable)
- **Risk**: HIGH — touches the write path of every chat turn. Mitigated by milestone ordering: consistency net first, semantics-preserving refactors next, behavior changes last.
- **Depends on**: — (M0 builds its own test net; does not wait on blocked plan 022)
- **Category**: architecture
- **Planned at**: commit `02146b4`, 2026-07-06

## Why this matters

The chat core is **already half event-sourced** and that half is good: `session_events` is an append-only fact log with per-aggregate `version` + global `sequence_id`, projections into `messages` / `backend_runs` / `chat_session_queue_items` / `backend_run_snapshots` are written in the same SQLite transaction, a per-session actor serializes writes, recovery replays facts, and the renderer tails the log over SSE with cursors and `SnapshotRequired` gap handling.

What makes it *not* native Event Sourcing:

1. **The log is not the source of truth.** Streaming partial-snapshot flushes and several service paths write projection tables directly, bypassing the log. You cannot rebuild `messages` from `session_events` alone.
2. **Events are projection rows, not domain facts.** Payloads embed Drizzle insert types (`NewMessage`, `NewBackendRun`) and even projection hints (`assistantMessageProjection: 'insert' | 'update'`). The log is coupled to the current DB schema and to how the projector happens to work today.
3. **No decision layer.** Command helpers append events directly; there is no pure `decide(state, command) → events` step, so invariants (one active run, no queue claim without a pending item) are enforced ad hoc at call sites.
4. **No real concurrency control.** `appendSessionEvent` does read-max-version+1 with no `expectedVersion` check; correctness rests entirely on the in-process actor, with the unique index `(aggregate_id, version)` as a silent last resort.
5. **No event schema versioning.** `parseStoredChatSessionEvent` blind-casts stored JSON; any payload change is a latent replay bug against historical logs.
6. **No rebuild capability.** Recovery repairs specific known drifts (`es/recovery.ts`), but there is no general "drop projections, replay log, verify parity" tool — the core payoff of ES.

## Current state (confirm each before editing)

Keep (already correct, do not redo):

- `packages/db/src/schema/chat.ts:168-194` — `session_events` table: autoincrement `sequence_id`, unique `(aggregate_id, version)`, unique terminal-fact-per-run partial index, virtual `subject_run_id`.
- `apps/server/src/modules/chat-runtime/es/commands.ts` — `commitSessionEvents*`: append + project in one transaction inside `runSessionActorTask`, then publish to tail subscribers.
- `apps/server/src/modules/chat-runtime/es/session-actor.ts` — per-session promise-chain serialization.
- `apps/server/src/modules/chat-runtime/es/event-tail.ts` — session/global SSE tail with cursor replay and `SnapshotRequired`.
- `apps/server/src/modules/chat-runtime/es/recovery.ts` — interrupted-run finalization and drift repair.
- Synchronous same-transaction projections. This is the right choice for a local single-writer SQLite app; do **not** introduce an async projection bus.

Fix (the gaps):

- `apps/server/src/modules/chat-runtime/es/events.ts:38-48` — payloads typed as `NewMessage & {...}` / `NewBackendRun & {...}`; `RunStartedPayload` carries `assistantMessageProjection`.
- `apps/server/src/modules/chat-runtime/es/events.ts:190-196` — `parseStoredChatSessionEvent` casts with no version/upcast step.
- `apps/server/src/modules/chat-runtime/es/event-store.ts:37-55` — no `expectedVersion`; version derived by re-reading max.
- Direct projection writes bypassing the log (found via `rg "(insert|update|delete)\((messages|backendRuns|chatSessionQueueItems)\)" apps/server/src`):
  - `apps/server/src/modules/chat-runtime/stream/active-run-stream.ts:67-` — `persistStreamingMessageSnapshot` updates `messages` mid-run (fenced, but logless).
  - `apps/server/src/modules/chat-runtime/stream/projection.ts:30-51` — `persistMessageSnapshot` updates `messages` + `sessions` directly; used by terminal projection helpers and by plan-implementation approval.
  - `apps/server/src/modules/chat-runtime/interaction/plan-implementation-approval.ts:101` — mutates a stored message via `persistMessageSnapshot` with no fact.
  - `apps/server/src/modules/external-work-import/service.ts:767` — inserts `messages` rows directly from another module.
  - `apps/server/src/modules/provider-targets/service.ts:494` — updates `chatSessionQueueItems` directly from another module.
- `apps/server/src/modules/chat-runtime/es/aggregate.ts` — `reduceChatSessionEvents` exists but is only used for recovery, not as the write-side decision state.

## Commands you will need

| Purpose        | Command                                             | Expected |
|----------------|-----------------------------------------------------|----------|
| Typecheck      | `pnpm --filter @cradle/server typecheck`            | exit 0   |
| Server tests   | `pnpm --filter @cradle/server test`                 | all pass |
| Focused ES     | `pnpm --filter @cradle/server test -- es`           | all pass |
| Full suite     | `pnpm test`                                         | all pass |

## Scope

**In scope**: `apps/server/src/modules/chat-runtime/es/*`, the direct-write call sites listed above, `packages/db/src/schema/chat.ts` (one additive column), a projection-rebuild dev tool, and the chat-runtime README.

**Out of scope**:
- Session metadata lifecycle (create/archive/read-unread/delete) — stays owned by the session module; the `ChatSession` aggregate boundary is the transcript + runs + queue + interactions, not session identity.
- The AI SDK `UIMessageChunk` SSE transport and replay buffers — deltas remain ephemeral transport (see "Considered and rejected").
- Frontend stores — the tail contract is preserved; renderer changes are not required.
- `backend_run_snapshots` forensic records — they stay a write-through diagnostic sink, not a log-rebuildable projection.

## Milestones

### M0 — Consistency net (no behavior change)

Build the tool that every later milestone verifies against.

1. Write a **log/projection parity checker** (`es/parity.ts` + test): for a session, replay `session_events` through the existing projector logic into in-memory rows and diff against actual `messages` / `backend_runs` / `chat_session_queue_items` rows. It must classify diffs into "expected logless writes" (the known bypass paths above) and "unexplained drift". Expose it as a dev script (e.g. `pnpm --filter @cradle/server exec tsx scripts/chat-es-parity.ts <sessionId>`).
2. Add characterization tests around the write path: ordinary turn, queued turn drain, steer, cancel, interrupted-run recovery, rollback. Assert both the projected rows **and** the exact event sequence in `session_events`.

**Verify**: parity checker reports only the known bypass categories on a freshly exercised test DB; new tests pass.

### M1 — Domain event contracts + versioning (semantics-preserving)

1. In `es/events.ts`, redefine every payload as a **self-contained domain fact**: plain interfaces owning their fields, no `NewMessage` / `NewBackendRun` imports, no projector hints. `RunStartedPayload.assistantMessageProjection` moves into projector logic (the projector can decide insert-vs-update by checking row existence, or the fact can carry `reusesAssistantMessageId` as a *domain* statement for approval continuation).
2. Add `schemaVersion` to the stored envelope. Prefer embedding it in the payload JSON (`{ v: 2, ... }`) over a DB migration; fall back to a column only if querying by version becomes necessary.
3. Introduce an **upcaster** step in `parseStoredChatSessionEvent`: `upcast(eventType, rawPayload) → CurrentPayload`. Version 1 = today's row-shaped payloads; write upcasters v1→v2 for every event type so historical logs replay into the new contracts. Add fixture tests with captured v1 JSON.
4. Extract the tail-DTO slimming (`readTailPayload`) to consume the new contracts; the SSE wire shape must not change.

**Verify**: typecheck + full server tests; parity checker on a DB seeded with pre-refactor fixture events shows no unexplained drift; a snapshot test locks the SSE tail JSON shape.

### M2 — Decision layer + optimistic concurrency (semantics-preserving)

1. Promote `es/aggregate.ts` to the write-side state: `evolve(state, event) → state` (rename of the reducer) and a new pure `decide(state, command) → ChatSessionEvent[] | DomainError` in `es/decide.ts`. Start with the commands that have real invariants: `startRun` (reject if `activeRun` exists), `completeRun`/`failRun`/`abortRun` (reject if run id is not the active run — replacing today's fence-and-ignore in some paths with an explicit decision), `claimQueueItem`, `rollbackLastTurn`.
2. Add `expectedVersion` to `appendSessionEvent`; on mismatch (unique-index violation or read-check), surface a typed `concurrency_conflict` error instead of silently interleaving. The session actor remains the fast path; `expectedVersion` is the correctness guarantee if a second write path (another process, a future relay host) ever appears.
3. Command execution becomes: actor task → load state (replay events for the session; add an in-memory state cache keyed by `(sessionId, version)` if replay cost shows up in the profile) → `decide` → append with `expectedVersion = state.version` → project → publish.
4. Migrate call sites in `run/run-coordinator.ts`, `run/terminal-finalizer.ts`, `queue/drain.ts`, cancel, steer, rollback to go through `decide`. Keep the event sequences byte-identical to M1 (characterization tests from M0 prove it).

**Verify**: M0 characterization tests still pass unchanged; new unit tests for `decide` invariants; typecheck + full server tests.

### M3 — Close the dual-write paths

**Decision: Option A (native ES) is implemented.** The direct `messages` update in `persistStreamingMessageSnapshot` has been replaced with an `AssistantMessageSnapshotted` fact carrying the run id, compacted assistant `UIMessage` JSON, derived text, and byte size. The existing 10s flush throttle remains, and duplicate compacted snapshots are skipped so idle timers do not append no-op facts. Cost: superseded intermediate snapshots stay in the append-only log. Benefit: the log is complete — full rebuild can reproduce active-run partial text and parity has no expected-bypass category.

Then:

1. `interaction/plan-implementation-approval.ts` → new `PlanImplementationResponded` fact whose projector performs the message-part mutation currently done inline. Remove its `persistMessageSnapshot` call.
2. `stream/projection.ts` `persistMessageSnapshot` — after (1) and the option-A/B decision, its remaining legitimate callers should be projector-internal only; fold it into `es/projectors.ts` or delete it.
3. `external-work-import/service.ts:767` → append `UserMessageAppended` (or a dedicated `ExternalWorkImported` fact) through `commitSessionEvents` instead of raw insert. Read across, write within: another module must not write chat projections.
4. `provider-targets/service.ts:494` → expose a chat-runtime command (emitting the appropriate `QueueItemUpdated`-family fact) and call it, instead of updating `chatSessionQueueItems` from the provider-targets module.

**Verify**: `rg "(insert|update|delete)\((messages|backendRuns|chatSessionQueueItems)\)" apps/server/src --glob '!**/es/projectors.ts' --glob '!**/es/parity.ts' --glob '!**/es/rebuild.ts' --glob '!**/*.test.ts'` returns nothing; parity checker reports zero unexplained drift and zero expected-bypass categories on log-backed flows.

### M4 — Projection rebuild (the ES payoff)

1. Build `rebuildSessionProjections(sessionId)`: inside one transaction, delete the session's rows from `messages` / `backend_runs` / `chat_session_queue_items`, replay all events through the projectors, and run the parity checker. Expose as a dev script and use it in tests.
2. Rewrite `es/recovery.ts`'s drift-repair branch to *use* rebuild (or at least the same replay core) instead of hand-coded per-case repairs where equivalent.
3. Add a round-trip test: exercise a full multi-turn session (turns, queue, steer, cancel, rollback), snapshot projections, rebuild from log, assert byte-equal rows (modulo Option-B streaming cache).

**Verify**: round-trip test passes; recovery tests still pass.

### M5 — Log hygiene + documentation

1. Decide and document retention: `session_events` for deleted sessions (today: check what session deletion does to the log — cascade or orphan?) and, under Option A, whether superseded `AssistantMessageSnapshotted` events participate in the existing snapshot-compaction pass when *read* (never rewrite stored events; compaction applies at replay/projection time only).
2. Profile replay cost for the largest real sessions (`CRADLE_CHAT_RUNTIME_PROFILE=1`); if state loading in M2 shows up, add the `(sessionId, version)` state cache noted there. Do **not** add aggregate snapshot tables unless profiling proves the need.
3. Update `apps/server/src/modules/chat-runtime/README.md` (the `session_events` paragraph and `es/*` file list) to describe the decide/evolve layer, `expectedVersion`, upcasting, and the rebuild tool.

**Verify**: README review; profile numbers recorded in `plans/README.md` follow-up notes.

## Done criteria

- [x] All chat projection writes flow through `session_events`
- [x] Event payloads have no imports from `@cradle/db` row types; every event has a `schemaVersion` and v1 upcasters with fixture tests
- [x] `decide`/`evolve` own invariants; `appendSessionEvent` enforces `expectedVersion`
- [x] `rebuildSessionProjections` round-trip test passes on a full-feature session
- [x] `pnpm --filter @cradle/server typecheck` and `pnpm test` exit 0
- [x] `plans/README.md` status row updated with milestone-level progress

## STOP conditions

- M0 parity checker finds **unexplained** drift categories beyond the bypass paths listed here — STOP; those are live bugs to fix (or plan separately) before restructuring the write path.
- M1 upcasting hits an event whose historical payload cannot be losslessly mapped to a domain fact — STOP and decide a tolerant-read rule with the owner rather than inventing data.
- M3 `AssistantMessageSnapshotted` profiling shows unacceptable log growth on real long sessions — STOP and revisit the flush throttle/coalescing policy rather than adding event deletion.
- Any milestone requires changing the SSE tail wire shape consumed by `apps/web` — STOP; renderer migration is a separate plan.

## Considered and rejected (do not re-litigate)

- **Logging AI SDK `UIMessageChunk` deltas as events** — rejected. High-frequency text/reasoning deltas are transport, not domain facts; volume would swamp the log. The replay-buffer + snapshot-flush design already handles late joiners.
- **Async projections / CQRS bus / outbox** — rejected. Single-process local SQLite; same-transaction projections give read-your-writes for free and recovery already covers crashes.
- **External event-store framework (EventStoreDB, emmett, etc.)** — rejected. The 400-line hand-rolled store fits the SQLite + Drizzle rules and the ownership model; the gaps are design gaps, not missing infrastructure.
- **Aggregate snapshot tables** — deferred, not adopted. Per-session event counts are small; add only if M5 profiling proves replay cost.
- **Making session metadata part of the ChatSession aggregate** — rejected. Session module ownership stands; `TitleChanged` remains the one sanctioned cross-boundary projection already in place.

## Maintenance notes

- Reviewer focus: M2 must not change any event *sequence* produced by existing flows — the M0 characterization tests are the contract.
- After M3, add an ast-grep rule (repo has `sgconfig.yml`) forbidding `insert/update/delete` on chat projection tables outside `es/projectors.ts`.
- Pairs with plan 020 (god-file splits): `runtime.ts` and `run/*` call-site migration in M2 is a natural moment to split, but keep splits out of this plan's diffs.
