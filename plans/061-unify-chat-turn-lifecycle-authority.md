# Plan 061: 统一 Chat turn 生命周期权威并根除 synthetic run storm

> **Executor instructions**: Execute milestones in order. Run every verification
> command and confirm the expected result before moving on. This is an intentional
> breaking refactor: remove superseded lifecycle seams instead of retaining
> compatibility wrappers. If a STOP condition occurs, stop and report rather than
> weakening an invariant. Update the Plan 061 row in `plans/README.md` when done.
>
> **Drift check (run first)**:
> `git diff --stat b2d90065..HEAD -- apps/server/src/index.ts apps/server/src/app.ts apps/server/src/modules/chat-runtime apps/server/tests/chat-runtime.test.ts apps/server/tests/chat-runtime-recovery.test.ts packages/db/src/schema/backend-control-plane.ts packages/db/drizzle apps/web/src/features/chat apps/web/src/api-gen`
> If an in-scope file changed, compare it against the current-state excerpts below.
> A semantic mismatch in admission, synthetic event ordering, terminal ordering,
> recovery boot order, or history hydration is a STOP condition.

## Status

- **Priority**: P0
- **Effort**: XL (six ordered milestones)
- **Risk**: HIGH
- **Depends on**: `plans/024-chat-native-event-sourcing.md` (DONE), `plans/041-enforce-domain-and-lifecycle-ownership.md` (DONE), `plans/054-make-websocket-run-stream-resumable.md` (DONE)
- **Supersedes**: `plans/044-own-chat-turn-completion.md`
- **Category**: correctness, architecture, performance, migration
- **Planned at**: commit `b2d90065`, 2026-07-20

## Why this matters

Session `8f9964fe-9df6-4d09-aa28-88f0aeee0235` is a concrete production-shaped
failure: it contains 887 messages (3 user, 884 assistant) and 884 runs, of which
880 were persisted as streaming in the same second and later recovered as failed
with `response.interrupted`. The shape identifies top-level system/synthetic turns:
they create assistant messages without corresponding visible user messages.

The causal chain is present in current source:

1. Claude Agent may publish many background chunks for one `providerTurnId`.
2. `provider-synthetic-turn.ts:58-63` checks a Map, awaits run creation, and only
   then inserts the state. Concurrent callbacks all observe the missing entry.
3. `es/decide.ts:81` and `es/aggregate.ts:57` explicitly exempt `system` runs from
   the aggregate's single-active-run invariant, so every racing callback commits.
4. `run-coordinator.ts:79-104` also checks in-memory state only after awaiting
   opportunistic recovery, then sets pending state with a non-atomic check/set.
5. `runtime.ts:348-350` floats the executor promise. `terminal-finalizer.ts` marks
   in-memory terminal before durable commit and converts commit failure to `null`.
6. `index.ts:135-145` starts listening before persisted-run recovery finishes.
7. `history-api.ts:104-157` selects, parses, compacts, and validates every stored
   message in one request, so a damaged session turns durable fan-out into repeated
   CPU work whenever it is opened.

Plan 024 already made `session_events` the fact source with synchronous Drizzle
projections and a per-session actor. Do not introduce another actor framework,
async projector, or event bus. Deepen that existing boundary so one session turn
has one admission owner, one completion owner, one durable invariant, and bounded
read cost.

## Current state

- `apps/server/src/modules/chat-runtime/run/provider-synthetic-turn.ts:36-63` stores
  only completed `ProviderSyntheticTurnState`; there is no synchronous in-flight
  entry or per-provider-turn inbox.
- `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts:1306-1337`
  launches synthetic event publication without serializing callbacks; the Chat
  Runtime consumer must therefore accept concurrent delivery.
- `apps/server/src/modules/chat-runtime/es/decide.ts:77-103` enforces active-run
  rejection only when origin is not `system`; `:106-120` similarly lets any system
  terminal event bypass active identity.
- `apps/server/src/modules/chat-runtime/es/aggregate.ts:51-69` does not project a
  system `RunStarted` into `activeRun`.
- `apps/server/src/modules/chat-runtime/run/run-coordinator.ts:79-104` leaves an
  await gap before pending admission, and `turn-draft.ts:56-116` persists a user
  message before `RunStarted`, allowing a losing request to leave an orphan.
- `packages/db/src/schema/backend-control-plane.ts:43-68` has ordinary indexes but
  no database-level guarantee that a session has at most one streaming run.
- `apps/server/src/modules/chat-runtime/run/turn-executor.ts:136-215` owns some
  release/drain ordering, while `provider-synthetic-turn.ts:166-182`, cancel, and
  terminal finalization own overlapping variants.
- `apps/server/src/modules/chat-runtime/run/terminal-finalizer.ts:55-111` sets
  `terminalStatus` before persistence; `:137-198` catches persistence failure and
  returns `null`, allowing the caller to continue lifecycle cleanup without a
  durable terminal fact.
- `apps/server/src/modules/chat-runtime/runtime.ts:321-350` assembles stage-level
  lifecycle primitives and dispatches `void executeRunWithDeps(...)`.
- `apps/server/src/app.ts:257-288` can call recovery without awaiting it;
  `apps/server/src/index.ts:135-145` listens first and recovers in the callback.
- `apps/server/src/modules/chat-runtime/history-api.ts:104-157` hydrates all message
  payloads; `http/history.routes.ts:12-29` exposes no cursor or limit; the Web driver
  uses a single `useQuery` snapshot and replaces the whole session message array.

## Target architecture

```text
provider/user intent
        |
        v
existing per-session actor ── decide(start; all origins) ── same-tx facts/projections
        |                                  |
        |                                  └─ DB partial unique: one streaming/session
        v
one ActiveTurn handle ── provider pump ── typed outcome
        |                                  |
        └──────── one completion owner <────┘
                   durable terminal -> required bookkeeping -> notify
                   -> release exactly once -> queue/goal handoff

server boot: migrate -> recover all persisted runs -> accept requests
history read: newest bounded page -> cursor pages on demand
```

`runRegistry` remains a live-resource projection and cancellation handle. It is
not the correctness authority. `session_events` + same-transaction projections
remain the fact source, and the database unique index is the final guard.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Generate migration | `pnpm --filter @cradle/db exec drizzle-kit generate` | one reviewed migration + metadata update |
| Server typecheck | `pnpm typecheck:server` | exit 0, boundary check included |
| Web typecheck | `pnpm typecheck:apps-web` | exit 0 |
| Focused lifecycle tests | `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/run apps/server/tests/chat-runtime-recovery.test.ts --maxWorkers=1` | all pass |
| Chat integration tests | `pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts tests/chat-runtime-recovery.test.ts --maxWorkers=1` | all pass |
| Focused Web tests | `pnpm --filter @cradle/web exec vitest run src/features/chat/session --maxWorkers=1` | all pass |
| Server suite | `pnpm test:server` | all pass or only documented pre-existing unrelated failures |
| Scoped lint | `pnpm exec eslint apps/server/src/index.ts apps/server/src/app.ts apps/server/src/modules/chat-runtime apps/web/src/features/chat packages/db/src/schema/backend-control-plane.ts` | exit 0 |
| Diff hygiene | `git diff --check` | no output |

## Scope

**In scope**:

- `apps/server/src/modules/chat-runtime/**` admission, synthetic delivery,
  completion, recovery, HTTP history contract, tests, and README
- `apps/server/src/index.ts` and the narrow boot/recovery seam in `app.ts`
- `packages/db/src/schema/backend-control-plane.ts` and one Drizzle migration
- generated OpenAPI clients affected by the history query/response change
- `apps/web/src/features/chat/**` history pagination, stable cache, and focused tests
- exact regression coverage for the reported 880-run failure shape

**Out of scope**:

- provider-native protocol redesign; providers may continue concurrent delivery
- async projections, a second event store, or replacing the existing session actor
- deleting or rewriting historical `session_events`
- provider-thread child transcripts, side chat, queue product policy, or goal semantics
- visual redesign beyond the minimal “load earlier messages” affordance
- changing process-level fatal policy; the fix is to observe lifecycle promises

## Git workflow

- Branch: `advisor/061-unify-chat-turn-lifecycle-authority`
- Use milestone-sized logical commits.
- Do not push, merge, or open a PR unless explicitly instructed.

## Milestones

### M0 — Build a failing consistency net

Add deterministic tests with deferred promises; do not use sleeps.

1. Deliver at least 100 concurrent main-thread synthetic events with one
   `providerTurnId` while run creation is deferred. Assert one system run, one
   assistant message, ordered chunks, one terminal notification, and one release.
2. Start concurrent ordinary create-run requests while recovery/runtime resolution
   is deferred. Assert one admission and no orphan visible user messages.
3. Reject terminal persistence. Assert no provider-success notification, no queue
   handoff, one release, and an observed lifecycle rejection.
4. Exercise boot with persisted streaming runs. Assert response routes are not
   callable until recovery has produced terminal facts/projections.
5. Seed 887 messages and assert initial history hydration parses no more than the
   requested page size; older pages remain reachable by cursor.

Record why each test fails against `b2d90065` before changing implementation.

### M1 — Make admission a durable all-origin invariant

1. Remove the `system` exemptions from `decideStartRun`, terminal decisions, and
   `evolveChatSessionState`. Every top-level `RunStarted` owns `activeRun`; provider
   child threads remain outside this aggregate as they are today.
2. Refactor draft construction to be pure. Commit a visible user message (when one
   exists), assistant message, queue claim metadata, and `RunStarted` in one actor
   transaction. A rejected start must leave no user/assistant projection behind.
3. Replace registry check-then-set with one synchronous `claimPendingRun` operation
   performed before the first await. The registry claim improves local behavior but
   must not be treated as the durable invariant.
4. Add a partial unique Drizzle index on `backend_runs(chat_session_id)` where
   `status = 'streaming'`. The migration must first terminalize inherited streaming
   rows as `response.interrupted`; it must not delete rows or event history.
5. Give recovery an explicit recovery-only terminal command/path that may append a
   missing terminal fact for an already-terminal persisted run after validating the
   projection row. Normal terminal commands remain strict. This is required so the
   migration can reconcile legacy multi-system-run storms without retaining a
   general system-origin bypass.
6. Convert unique-index/domain conflicts into stable `chat_run_in_progress` 409s.

Run ES parity/rebuild tests after this milestone. The event log must still rebuild
the same projections after recovery adds the missing facts.

### M2 — Serialize synthetic turns by identity

Replace the check-then-act Map with a session-owned synthetic turn inbox:

- install the per-`providerTurnId` in-flight entry synchronously before any await;
- serialize event batches for that identity in delivery order;
- create at most one top-level run and keep its state until a terminal chunk;
- make duplicate start/terminal chunks idempotent without dropping distinct deltas;
- observe every queued handler rejection and convert an open synthetic turn to one
  failed typed outcome;
- remove the entry only after durable completion and release.

Do not make Claude Agent serialize delivery; concurrent provider delivery is a
valid input that Chat Runtime must own. The all-origin aggregate and DB invariant
from M1 must independently reject a second run if the inbox regresses.

### M3 — Establish one admission/completion lifecycle surface

Complete and supersede Plan 044 inside this plan:

1. Expose one narrow Chat Runtime operation that accepts a normal, cancel, provider
   synthetic, or recovery outcome. Provider/runtime code supplies outcomes, not
   `publishTerminalChunk` / `releaseActiveRun` / `scheduleQueueDrain` primitives.
2. Required order is: pump outcome -> durable terminal facts/projections -> required
   completion bookkeeping -> terminal notification -> idempotent release -> queue
   or goal handoff. Mark usage/profile/trace stages explicitly required or
   best-effort and lock the order in tests.
3. Do not set `activeRun.terminalStatus` before durable commit. Do not catch terminal
   persistence and return `null`. A failed durable terminal must never publish
   provider success or drain the queue; run the explicit recovery path, and if that
   also fails, record an incident and leave handoff blocked.
4. Change executor dispatch to an observable `Promise<void>` and attach a contextual
   rejection handler. The dispatch catch must not perform duplicate cleanup.
5. Migrate normal, cancel, synthetic, stale-fence, and shutdown paths. Delete the
   overlapping stage-level dependency bags and direct lifecycle ordering.

### M4 — Make recovery a boot readiness barrier

1. Await persisted-run recovery before `listen`. Recovery failure is a bootstrap
   failure: do not accept write or read traffic against ambiguous run state.
2. Remove `recoverPersistedRunsOnCreate` fire-and-forget behavior and the
   opportunistic recovery call from ordinary create/queue/steer/rollback requests.
   Explicit maintenance/recovery APIs may still recover a named session.
3. Ensure background tasks and provider reconnection start only after recovery.
4. Preserve process fatal handlers, but prove all chat lifecycle promises are
   observed so an ordinary turn rejection cannot become `unhandledRejection`.

### M5 — Bound history hydration and preserve access to old messages

Make the history contract cursor-paginated as an intentional breaking change.

1. `GET /chat/sessions/:sessionId/messages` accepts a bounded `limit` (default 100,
   max 200) and an opaque backwards cursor based on stable message insertion order.
   It returns newest-page rows in transcript order plus `nextCursor` and the current
   event `revision`. Select candidate rows first and hydrate/parse payloads only for
   that page; checkpoint overlay is likewise page-scoped.
2. Regenerate the API client. Convert the Web driver to an infinite query that loads
   the newest page on entry and prepends older pages on demand without replacing
   live streamed messages or moving the scroll anchor.
3. Add a minimal “load earlier messages” affordance following the existing design
   system. Stable IndexedDB cache stores the loaded window and cursor metadata, not
   an assumed complete transcript.
4. Keep export as the complete-history path. Do not heuristically delete or collapse
   the 880 historical facts: old events lack `providerTurnId`, so automatic grouping
   would be unverifiable. Pagination makes their cost user-driven and bounded.

### M6 — Documentation and final verification

Update Chat Runtime README and DB schema README with:

- all-origin single-active-run semantics;
- registry as live projection, event store + unique index as authority;
- synthetic inbox identity/lifecycle;
- required completion barriers and recovery failure policy;
- boot readiness ordering;
- bounded history cursor semantics and complete export path.

Run every command in the command table, inspect the generated migration and API
diffs, and run `git diff --check`.

## Test plan

- 100-way concurrent same-identity synthetic delivery; exactly one run/message.
- Concurrent different synthetic identities for one session; second is rejected or
  queued by explicit policy, never concurrently streaming.
- Concurrent ordinary creates; one run and no orphan user messages.
- System run followed by user run and vice versa; strict active identity.
- Migration fixture with multiple legacy streaming system runs; all become failed,
  recovery appends terminal facts, unique index is installed, parity passes.
- Terminal commit and recovery failure injection; no success notify/handoff.
- Normal/cancel/synthetic/stale/shutdown completion exactly-once assertions.
- Server boot readiness test and no unhandled rejection test.
- 887-message history fixture: first request hydrates at most 100, cursors return all
  rows exactly once in transcript order, and live updates coexist with loaded pages.

## Done criteria

- [ ] The 100-way synthetic regression creates exactly one system run and assistant message.
- [ ] `system` has no aggregate admission or terminal bypass.
- [ ] Database rejects a second streaming run for one session.
- [ ] Losing create requests leave no orphan transcript rows.
- [ ] All terminal paths share one completion owner and durable terminal precedes notification.
- [ ] Every executor/synthetic callback promise is observed.
- [ ] Server accepts no traffic before persisted-run recovery succeeds.
- [ ] Initial Session open hydrates at most 100 message payloads; all older history remains cursor-accessible.
- [ ] Existing event history is preserved; migration/recovery parity tests pass.
- [ ] Focused/full verification, typechecks, lint, generated-contract checks, and diff hygiene pass.
- [ ] `apps/server/src/modules/chat-runtime/README.md`, DB README, and `plans/README.md` are current.

## STOP conditions

- Event replay reveals a legitimate requirement for two concurrent top-level runs in
  one session. Stop and separate that concept from `backend_runs` instead of weakening
  the invariant.
- The migration cannot terminalize inherited streaming rows before index creation
  while allowing recovery to append valid terminal facts. Stop and design a staged
  migration; do not ship the index without upgrade safety.
- Provider synthetic events lack stable `providerTurnId` within a live parent run.
  Stop and fix the provider contract; do not dedupe by timing/content heuristics.
- Completion requires a timeout/retry heuristic. Stop and request an explicit policy.
- Cursor ordering cannot be made stable with existing message identity/insertion
  order. Stop before adding a new DB column; schema expansion requires owner review.
- Any verification fails twice for the same in-scope reason, or implementation
  requires provider-native protocol/UI redesign beyond the stated scope.

## Maintenance notes

- New top-level run origins must participate in the same aggregate and DB invariant.
- New provider background-delivery paths must declare a stable turn identity and use
  the synthetic inbox.
- New completion stages must be classified required/best-effort and added to ordering tests.
- Never move persisted recovery after `listen` for startup latency.
- History consumers must not reintroduce an unbounded “all payloads” hydration route.
