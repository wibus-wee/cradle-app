# Plan 074: Bound Codex runtime state, trust native context usage, and backpressure the shared host

> **Executor instructions**: Follow this plan in order. Keep `Progress`,
> `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective`
> current after every stopping point. Run each focused verification before
> continuing. Do not push or open a pull request unless instructed.
>
> **Drift check (run first)**:
> `git diff --stat 4b092246..HEAD -- apps/server/src/modules/chat-runtime-providers/codex apps/server/src/modules/chat-runtime-providers/kit/state-snapshot.ts apps/server/src/modules/provider-runtime apps/server/src/modules/chat-runtime/runtime-session-context.ts apps/server/src/modules/chat-runtime/http/introspection.routes.ts apps/web/src/features/chat/context apps/web/src/features/chat/runtime packages/chat-runtime-contracts/src/index.ts`
> If an in-scope ownership boundary or interface has changed, reconcile this
> plan with the live code before editing. Stop instead of layering a second
> state or notification abstraction over a newly landed replacement.

This plan is a living document. It follows the repository's existing
`plans/NNN-*.md` convention and the ExecPlan requirement that a stateless
executor can complete the work from this file alone.

## Status

- **Execution**: DONE
- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: completed Plan 052's provider-target-owned Codex app-server
  host. This plan repairs and completes that ownership model; it does not
  restore session-scoped app-server processes.
- **Category**: correctness, performance, architecture, migration, tests
- **Planned at**: commit `4b092246`, 2026-08-12
- **Supersedes**: the current Codex native-history snapshot and estimated
  Context Usage design. It also replaces whole-snapshot signature comparison
  and the host's payload-retaining pending/lease queues.

## Purpose / Big Picture

After this plan, a long Codex conversation no longer makes Cradle's server
heap and CPU scale with the conversation's complete native rollout. Opening
Context Usage shows Codex's native current-window total without pretending
that Cradle knows the provider's hidden prompt composition. A warm shared
app-server host cannot accumulate an unbounded notification mailbox, including
for pinned side conversations, and a dead host generation cannot be handed to
future turns.

The visible proof is a long-session scenario in which Context Usage continues
to show the native token total, server memory remains bounded while tool output
streams, and a later turn resumes the same provider thread. The structural proof
is stronger than a timing threshold: no durable Codex checkpoint contains
`Turn[]`, no notification update serializes a checkpoint, no lease owns a
payload queue, and old large snapshots are compacted and written back once.

## Progress

- [x] (2026-08-12 02:21Z) Completed the read-only audit and selected the combined architecture direction.
- [x] (2026-08-12 02:21Z) Wrote this implementation plan against commit `4b092246`.
- [x] (2026-08-12) Characterized snapshot size, native usage semantics, host pressure, routing, and host recreation.
- [x] (2026-08-12) Removed native history and estimated Context Usage; legacy Codex values normalize to the bounded provider-owned checkpoint and write back on resume.
- [x] (2026-08-12) Added the shared checkpoint dirty revision and migrated every production snapshot assignment through it.
- [x] (2026-08-12) Cached UI-slot host/thread facts per host generation with native-event invalidation, eliminating repeat native RPC fan-out on unchanged polls.
- [x] (2026-08-12) Replaced lease/pending payload tails with pull delivery, in-flight bind ownership, exact request routing, and generation-aware invalidation.
- [x] (2026-08-12) Updated owner documentation and completed focused verification.

## Surprises & Discoveries

- Observation: the largest observed Codex binding snapshot was 104.8 MB and
  was dominated by `codex.nativeHistory.turns`.
  Evidence: parsing and rewriting that local sample used approximately 528 MB
  V8 heap and 971 MB RSS in a one-shot benchmark. Rewriting a 5.7 MB sample 500
  times consumed about seven seconds of CPU. The database is only the storage
  location; the sustained load is JavaScript allocation, serialization, and GC.

- Observation: existing-thread recovery does not consume full history.
  Evidence: `thread/resume` is called using `providerSessionId` with
  `excludeTurns: true`; the production Provider Runtime new-session path passes
  `previousProviderStateSnapshot: null`. `hydrateCodexNativeHistory` runs after
  turns for a reconstruction path that the production owner does not use.

- Observation: Context Usage has two semantic errors in addition to its cost.
  Evidence: `context-usage-projector.ts` estimates item tokens with characters,
  rescales invented sections to a native aggregate, and uses
  `last.inputTokens` (or cumulative `total.inputTokens`) as current occupancy.
  The existing compact projector already treats `last.totalTokens` as the
  current-window value.

- Observation: the shared host has two different pressure failures.
  Evidence: active lease clients append to an unbounded array; unmatched
  notifications use a count-capped but byte-unbounded pending tail that silently
  drops its prefix. A pinned side-conversation lease retains a subscribed client
  even though later turns acquire a different consuming lease for the same
  thread.

- Observation: the generic snapshot migration API is not a usable owner.
  Evidence: its migration map is keyed only by a numeric version shared by all
  providers, no provider registers a migration, and read-time migration has no
  write-back contract.

## Decision Log

- Decision: Context Usage for Codex uses only native aggregate facts. The
  detailed `getContextUsage` capability returns `null`; the existing compact UI
  slot remains the aggregate source.
  Rationale: native token events do not expose system/message/tool composition.
  Returning an object with empty or estimated sections is labeled "Provider
  breakdown" by the current renderer and would still be false precision.
  Date/Author: 2026-08-12 / Codex audit.

- Decision: current window occupancy is `last.totalTokens`. Do not substitute
  `last.inputTokens`, and do not fall back to cumulative `total` when `last` is
  absent or zero.
  Rationale: `total` is lifetime accounting, while `last` is the native latest
  context-window report. Missing current data is unavailable, not lifetime
  occupancy.
  Date/Author: 2026-08-12 / Codex audit.

- Decision: retain the existing database column but replace its Codex value with
  a small provider-owned checkpoint. Do not add or alter a database schema.
  Rationale: the defect is payload ownership, not relational storage. A value
  migration can remove the old payload through the existing Drizzle directory.
  Date/Author: 2026-08-12 / Codex audit.

- Decision: rollout history remains owned by Codex, and the visible Cradle
  transcript remains owned by Chat Runtime. Neither is copied into the durable
  checkpoint, and the transcript is not called an exact replay of Codex prompt
  assembly.
  Rationale: the two histories have different semantics and retention. Existing
  resume needs only the provider thread id. Any future "replay into a new native
  thread" feature must state its lossy semantics separately.
  Date/Author: 2026-08-12 / Codex audit.

- Decision: use explicit dirty revision for binding checkpoints; do not hash or
  stringify the payload for equality.
  Rationale: deduplication must be O(1) in payload size and must not retain an
  escaped duplicate of the serialized state.
  Date/Author: 2026-08-12 / Codex audit.

- Decision: notification pressure is handled by ownership and backpressure, not
  by dropping, time-based coalescing, or guessed queue sizes.
  Rationale: approval, lifecycle, usage, diff, and tool events have semantic
  ordering. The safe baseline permits one message being delivered and zero
  queued payloads per operation, propagating pressure to the native stdout
  reader.
  Date/Author: 2026-08-12 / Codex audit.

- Decision: a pinned side-conversation host lease retains only the process
  resource. It does not create a notification subscriber.
  Rationale: subscription belongs to an active turn operation. Host lifetime and
  message consumption are distinct responsibilities.
  Date/Author: 2026-08-12 / Codex audit.

## Outcomes & Retrospective

Codex durable bindings now contain the common workspace/model envelope plus
`codex: { durableVersion: 1, contextUsage }`; rollout turns, tool payloads,
plans, diffs, approvals, and other live UI state cannot cross the persistence
boundary. The legacy characterization with 1 versus 1,000 large turns produces
byte-identical compact output. Existing native threads resume by id without a
`thread/turns/list` side effect or automatic transcript replay.

The existing bounded in-process UI projection remains available to current
consumers, while persistence always passes through the strict Codex codec.
Host/thread native facts are single-flight cached per generation; a second
unchanged UI-slot read issues no native requests. This was selected over a
second parallel projection object because the existing projection is already
semantically bounded after rollout removal, and introducing two live reducers
would recreate the ownership debt this plan is removing.

Notification delivery now holds at most the current delivered/early-bind
message in the pump. Pinned/request-only leases own no payload tail, idle events
are scalar-counted and discarded, and raw stdout is paused without pull credit.
Exact-generation invalidation prevents an old process exit from removing its
replacement.

Focused verification: 119 Codex/host/checkpoint tests, 5 Claude state-projector
tests, and 2 harness checkpoint tests passed; scoped ESLint, module boundaries,
structural searches, and `git diff --check` passed. Server and Web typechecks
reach only unrelated pre-existing plugin-SDK/conversation-bridge errors. The
existing Web context test cannot initialize its hash router in the current
Node-only Vitest environment (`window.history` is undefined); no changed Web
file has a type or lint finding.

## Why this is one plan

Deleting only the Context Usage estimator would stop one five-second scan but
would leave full history in every state mutation, whole-snapshot signatures, and
an unbounded lease mailbox. Deleting only native history would reduce the current
incident but leave the same mutable-blob architecture ready to regress. Adding a
queue cap would hide pressure by losing protocol facts. These failures share the
same missing boundary: durable provider identity, live projection, active
operation delivery, and provider-owned history must have separate lifecycles.

The milestone order still produces early relief. Legacy blobs are compacted and
new history writes stop before the larger live-projection and host refactors.

## Context and Orientation

`RuntimeSession` in `packages/chat-runtime-contracts/src/index.ts` is the
in-process provider session handle. It currently carries a serialized
`providerStateSnapshot`. Provider Runtime persists that string as
`backend_session_bindings.backend_state_snapshot` through
`apps/server/src/modules/provider-runtime/directory.ts`. The database row also
has the provider thread id in `backend_session_id`; that id is the fact Codex
uses to resume a thread.

Codex's current snapshot writer is
`apps/server/src/modules/chat-runtime-providers/codex/projection/state-projector.ts`.
It stores a complete `Turn[]` plus compact usage, goal, model, reasoning, status,
plan, tool activity, MCP, diff, terminal, approvals, filesystem, search, and
account usage in one JSON string. `projectCodexProviderStateSnapshot` invokes a
series of projectors for each streamed notification, and matching projectors
parse and serialize that shared string.

`apps/server/src/modules/chat-runtime-providers/codex/turn/thread-lifecycle.ts`
pages `thread/turns/list` with `itemsView: 'full'`, accumulates every page, and
writes the result after a normal turn. This history is also read by
`projection/context-usage-projector.ts`, which estimates a detailed context
breakdown. The renderer polls that endpoint every five seconds while compact
usage is relevant.

The provider-target-owned native process is represented by
`CodexAppServerHostResource` in `codex/app-server/host-resource.ts` and retained
by `provider-runtime/host-manager.ts`. Today every lease creates a client with an
unbounded notification array. The host has a second pending map for notifications
whose exact thread has no subscriber. "Backpressure" in this plan means the
producer cannot keep adding payloads while its consumer is stopped; it must wait
or pause the native readable stream.

The target state has four owners:

1. `CodexDurableCheckpoint` owns the small serialized facts worth carrying
   across server restarts: the common workspace/agent/model envelope plus the
   most recent bounded native token aggregate required for a cold context meter.
   It never owns turns, tool output, diffs, approvals, terminal output, plans,
   search results, or provider catalogs.
2. `CodexLiveThreadProjection` is a typed host-owned value keyed by native
   thread id. It owns current status and bounded UI projection while that host
   generation lives. Native notifications reduce into it once without JSON.
3. Codex owns native rollout/history. Chat Runtime owns its transcript and event
   log. A caller may page either source through its owner, but no durable runtime
   checkpoint copies either history.
4. `CodexThreadOperationSubscription` owns delivery for one active operation.
   Retaining a process, binding a thread, and consuming a turn are separate
   operations.

## Scope

In scope:

- Codex snapshot codec, native history removal, legacy value compaction, and
  write-back through the existing Drizzle Provider Runtime directory.
- Context Usage native aggregate semantics and renderer polling behavior when
  detailed usage is unsupported.
- A host-owned typed live projection for existing Codex UI slot state.
- Explicit dirty revision for provider-state persistence, replacing the
  whole-snapshot signature. Migrate all production snapshot writers that use
  the shared persistence seam so the invariant is enforceable, but do not
  redesign another provider's state contents in this plan.
- UI-slot hydration and invalidation needed to avoid twelve native calls per
  two-second poll.
- Active-operation notification delivery, side-conversation lease separation,
  early-bind handling, descendant ownership, synthetic request routing, and
  dead-host generation invalidation.
- Focused server/web tests, a non-gating representative benchmark, and README
  updates for affected owners.

Out of scope:

- Database schema changes or raw SQL. Existing binding writes continue through
  Drizzle.
- Reconstructing exact Codex prompt composition from Cradle messages, rollout
  history, tokenizer guesses, or scaling heuristics.
- Persisting Codex's full rollout somewhere else in Cradle.
- Redesigning Chat Runtime transcript retention or `session_events`.
- Changing provider-target ownership back to one process per chat session.
- Suppressing or merging notification deltas based on timing or content guesses.
- Full-repository test runs. The repository instructions require focused tests.

## Plan of Work

### Milestone 0: Characterize the contracts before changing them

Add failing focused tests around the boundaries this plan changes. Tests must use
fake Codex clients, deferred promises, and generated protocol values; do not use
browser automation, real native processes, sleeps, or a database schema change.

In `codex/provider.test.ts`, replace the test that blesses estimated Context
Usage with target behavior: `getContextUsage` is absent or returns `null`, while
the compact UI state reports `last.totalTokens` and `modelContextWindow`. Add a
case where `last` is zero and lifetime `total` is large; current occupancy must
remain unavailable/zero and must not display lifetime tokens as the current
window.

In `codex/projection/state-projector.test.ts`, construct two legacy snapshots
that differ only in history size. Assert the target durable codec produces the
same bounded checkpoint for both and removes `nativeHistory` and
`previousNativeHistory`. Do not assert a guessed byte ceiling; assert that the
encoded result is structurally independent of turn count and tool-output size.

In `codex/app-server/host-resource.test.ts`, characterize a blocked consumer,
two concurrent root threads, an early notification during thread binding, a
descendant thread, a pinned side conversation, a request without thread
identity, and native process termination followed by reacquisition. The target
tests must demonstrate zero accumulated payload queue, exact routing, one active
subscriber per operation, and a fresh host generation after termination.

In `chat-runtime/runtime-session-context.test.ts`, add a persistence fake that
proves unchanged revision skips a write and a changed revision writes once,
without serializing the snapshot to compute equality.

Expected result before implementation: new assertions fail for the specific
legacy behavior while unrelated focused tests remain green.

### Milestone 1: Stop producing and consuming full native history

Create `apps/server/src/modules/chat-runtime-providers/codex/state/durable-checkpoint.ts`.
It owns the Codex checkpoint interface and codec. Reuse
`WorkspaceProviderStateSnapshot` for the common envelope; do not duplicate
generated protocol types or shared UI DTOs. The provider-private checkpoint is
versioned inside the Codex namespace so its evolution cannot collide with other
providers:

    interface CodexDurableCheckpointState {
      durableVersion: 1
      contextUsage: {
        threadId: string
        total: CodexTokenUsageBreakdown
        last: CodexTokenUsageBreakdown
        modelContextWindow: number | null
        updatedAt: number
      } | null
    }

The codec must accept legacy snapshots, retain the common workspace/agent/model
envelope, retain only the bounded native token aggregate needed for cold display,
and discard every other `codex` field. It returns both the typed checkpoint and a
`didNormalize` flag. Encoding must use only typed owned fields; do not spread an
open legacy record back into the result.

Delete `CodexNativeHistorySnapshot`, `writeCodexNativeHistorySnapshot`,
`readRestorableCodexNativeHistory`, `hasCompleteCurrentCodexNativeHistory`,
`hydrateCodexNativeHistory`, `listFullCodexTurns`, previous-history injection,
and their tests. Existing thread recovery continues to use `providerSessionId`
and `thread/resume`. Starting a new provider target starts a new native thread;
do not silently replay Chat transcript or rollout history as equivalent native
state.

Change `resumeChatSession` to normalize with the Codex codec. In Provider
Runtime's existing-binding resolution, if the provider returns a normalized
serialized checkpoint different from the stored binding value, immediately
write that compact value once through `persistProviderRuntimeResolution` /
`writeProviderRuntimeBinding`. This is the legacy value migration. It must be
idempotent: the next resume reads the compact form and performs no write.

Remove the unused global numeric migration registry from
`chat-runtime-providers/kit/state-snapshot.ts`; keep only common-envelope
parsing there. Before deleting it, verify with `rg` that no production provider
registers a migration. Provider-specific codecs own provider-specific versions.

At the end of this milestone, reopening an old 100 MB binding makes one legacy
read and one compact write. Subsequent reads never load that history again.

### Milestone 2: Make Context Usage native and honest

Delete `projection/context-usage-projector.ts` and its heuristic tests. Codex
must not advertise detailed context composition while the native protocol only
provides aggregates. `getContextUsage` should be removed from the Codex provider
when the optional provider interface permits it; otherwise return `null` without
parsing provider state. Keep the shared `RuntimeContextUsage` contract unchanged
for runtimes that genuinely provide sections.

Update compact projection in `projection/ui-slot-projector.ts` and the shared web
reader in `apps/web/src/features/chat/context/lib/context-usage.ts` so current
window occupancy is exactly native `last.totalTokens`. Preserve `total` only as
lifetime/API accounting metadata; never substitute it into the current meter.
When native `last` is unavailable, render details/current occupancy unavailable
rather than zero-looking lifetime data.

Update all Context Usage queries under `apps/web/src/features/chat/context/` so
a `null` detailed response stops detailed polling. The aggregate continues to
arrive through the compact UI slot query. The full report must label the result
"Runtime aggregate" and must not show a provider-sections legend for Codex.

No tokenizer, characters-per-token formula, transcript scan, native rollout
scan, or "unattributed runtime context" bucket remains.

### Milestone 3: Separate durable checkpoint mutation from live projection

Add a shared runtime-session checkpoint mutation seam under
`apps/server/src/modules/chat-runtime/`, close to
`runtime-session-context.ts`. It must associate a scalar dirty revision with a
`RuntimeSession` and expose operations equivalent to:

    replaceRuntimeSessionProviderCheckpoint(
      runtimeSession: RuntimeSession,
      serializedCheckpoint: string | null,
    ): void

    readRuntimeSessionProviderCheckpointRevision(
      runtimeSession: RuntimeSession,
    ): number

The replace operation changes the serialized value and increments revision only
when durable checkpoint content changes. Migrate every production assignment to
`runtimeSession.providerStateSnapshot` through this seam, including Claude Agent
and harness writers, without changing those providers' payload semantics.
`attachBinding` caches scalar identity fields plus the revision and never embeds
the snapshot in a JSON signature. Remove `bindingByRuntimeSession.signature`.

Add `CodexLiveThreadProjection` to the Codex host resource, keyed by native
thread id. Its entry is reference-owned by active operations and active UI
readers, and is deleted when the last owner releases it; disposing the host
generation clears every remaining entry. Do not replace the durable-history
leak with an ever-growing host-level thread map. Split the current state
projector into a pure notification reducer over this typed live state and small
projection readers. Reuse existing `Codex*Snapshot` and shared
`Runtime*UiSlotState` types where they already express the facts; rename them
from `Snapshot` to `State` only where the persisted meaning would otherwise be
misleading.

Notification reduction must not read or write a JSON string. Bound collections
by semantic lifecycle, not arbitrary truncation: current-turn plan replaces the
previous plan; current command/process entries leave when terminal; pending
approval leaves when resolved; diff/search/filesystem state represents the
current operation; account/config/catalog data belongs to the host generation.
If an existing UI needs historical rows after their owner lifecycle ends, STOP
and identify its authoritative paginated source rather than adding an array cap.

At terminal turn completion, copy only the latest native token aggregate from
live projection into the durable checkpoint and bump its revision once. Other
live fields are rehydrated from native owner APIs or remain unavailable after a
restart until a native event supplies them.

### Milestone 4: Remove native RPC fan-out from polling reads

Refactor `CodexProvider.getUiSlotStates`. Acquiring the warm host and reading UI
slots must not issue the current unconditional twelve-request `Promise.allSettled`
on every HTTP poll.

Hydrate host-global facts such as model catalog, provider capabilities, config,
skills, plugins/apps, collaboration modes, MCP status, and rate limits once per
host generation through explicit loader promises stored on the host resource.
Invalidate and reload only when a corresponding native notification or a
Cradle-owned settings mutation proves the value dirty. This is event-driven
invalidation, not a time-to-live heuristic.

Hydrate thread facts through thread-scoped native reads when a thread is first
bound to that host generation. Live notifications maintain them thereafter.
Background terminals remain provider-owned and may use their dedicated query
only when the terminal slot is requested or displayed; do not make every slot
poll pay for it. If the current HTTP contract cannot express requested slots,
add an optional list of declared slot ids to the existing route and generated
client rather than creating provider-specific routes. Preserve a request with no
list as "all declared slots" for existing callers only if required during the
same change; remove the compatibility path before completing the plan if all
first-party callers can migrate atomically.

Frontend polling may remain as a cheap read of host-owned typed state. It must
not cause repeated native catalog/config calls or durable snapshot rewrites.

### Milestone 5: Make notification delivery operation-owned and backpressured

Replace `createCodexAppServerLeaseClient`'s automatic subscription and unbounded
`CodexAppServerMessage[]` with an explicit active-operation subscription. A
request-only/pinned lease can call JSON-RPC but receives no notification mailbox.
`streamTurn`, quick-question, rollback/title/maintenance operations that truly
consume events create and close a subscription in the same `try/finally` that
owns their turn.

The subscription interface must await consumption:

    interface CodexThreadOperationSubscription {
      readonly operationId: string
      bindRootThread(threadId: string): void
      bindDescendantThread(threadId: string, parentThreadId: string): void
      next(signal?: AbortSignal): Promise<CodexAppServerMessage | null>
      close(reason?: Error): void
    }

There may be one message currently handed to an operation and zero queued
payloads behind it. Update the raw app-server client so its stdout reader pauses
while notification delivery has no pull credit and resumes when the consumer
requests the next message. JSON-RPC responses and server requests must not be
left behind an unacknowledged notification in a way that deadlocks a consumer
making a native request; structure the stream loop so it finishes projection and
acknowledges delivery before issuing follow-up native RPCs. Prove this with a
deferred test, not a timeout.

Replace `pendingNotificationsByThreadId` with in-flight bind ownership. Before a
`thread/start`, `thread/resume`, or `thread/fork` request can emit events, register
the operation as an in-flight binder. If a notification arrives for a thread
whose bind response is still pending, the pump waits for that ownership result
without retaining a tail. A notification for an idle, unowned thread is recorded
as a scalar diagnostic and discarded; it is never replayed into a future turn.

Preserve descendant delivery by registering parent/child ownership from native
collaboration lifecycle facts. Do not infer ancestry from recency or broadcast
child events. If the protocol does not establish the relation before child
events, stop at the corresponding STOP condition.

Synthetic `serverRequest/pending` and `serverRequest/handled` notifications must
copy the resolved thread id to their top-level routing shape. Thread-scoped
requests route to exactly one operation handler. Native requests without a
thread id use an explicit method allowlist owned by the host generation; all
other unidentified requests fail closed with diagnostics. Delete the existing
"first result plus swallowed side-effect handlers" broadcast behavior.

When the raw process exits or closes, atomically mark that host generation
unhealthy, terminal-close its operations, and invalidate that exact resource in
`ProviderRuntimeHostManager`. A later acquire creates a fresh generation. Use a
generation identity so a delayed failure from an old process cannot invalidate
its replacement.

### Milestone 6: Documentation, cleanup, and observable proof

Update:

- `apps/server/src/modules/chat-runtime-providers/codex/README.md` with the four
  owners and native aggregate semantics;
- `apps/server/src/modules/provider-runtime/README.md` with checkpoint revision,
  provider-owned value migration, and generation invalidation;
- `apps/server/src/modules/chat-runtime/README.md` to preserve the rule that
  aggregate-only runtimes return `null` details;
- `plans/README.md` with final execution status when implementation completes.

Delete comments claiming Cradle needs a full app-server history snapshot for
target-change reconstruction. Document that existing-thread resume uses the
native thread id. Document any future explicit replay feature as lossy and out
of this plan.

Add a non-gating benchmark or diagnostic fixture that processes representative
large legacy history once, then streams a large count of small notifications
through a blocked fake consumer. Report allocations/RSS for engineering evidence,
but keep acceptance structural so CI is not tied to machine-specific millisecond
or heap thresholds.

## Concrete Steps

Run commands from `/Users/wibus/dev/cradle-app`.

1. Before edits:

       git status --short
       git diff --stat 4b092246..HEAD -- apps/server/src/modules/chat-runtime-providers/codex apps/server/src/modules/chat-runtime-providers/kit/state-snapshot.ts apps/server/src/modules/provider-runtime apps/server/src/modules/chat-runtime/runtime-session-context.ts apps/server/src/modules/chat-runtime/http/introspection.routes.ts apps/web/src/features/chat/context apps/web/src/features/chat/runtime packages/chat-runtime-contracts/src/index.ts

   Expect a clean worktree or only operator-owned changes that do not overlap
   this plan. Do not overwrite overlapping work.

2. Run the focused baseline before adding target tests:

       pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/codex/projection/state-projector.test.ts src/modules/chat-runtime-providers/codex/provider.test.ts src/modules/chat-runtime-providers/codex/app-server/host-resource.test.ts src/modules/chat-runtime-providers/codex/app-server/client.test.ts src/modules/provider-runtime/host-manager.test.ts src/modules/chat-runtime/runtime-session-context.test.ts --maxWorkers=1 --reporter=dot

   Record the exact pass count in `Artifacts and Notes`. Do not run the full
   server suite.

3. After Milestones 1 and 2, run:

       pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/codex/projection src/modules/chat-runtime-providers/codex/provider.test.ts src/modules/provider-runtime --maxWorkers=1 --reporter=dot

   Expect the legacy compaction, native aggregate, and idempotent write-back
   tests to pass.

4. After Milestones 3 through 5, run:

       pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/codex src/modules/provider-runtime/host-manager.test.ts src/modules/chat-runtime/runtime-session-context.test.ts --maxWorkers=1 --reporter=dot

   Expect all scoped tests to pass, including slow-consumer, early-bind,
   descendant, cross-session request isolation, side-lease, and crash/reacquire
   cases.

5. Run web tests for the native aggregate fallback and stopped detailed polling:

       pnpm --filter @cradle/web exec vitest run src/features/chat/context --maxWorkers=1 --reporter=dot

6. Run type and boundary checks:

       pnpm --filter @cradle/server typecheck
       pnpm --filter @cradle/web typecheck
       pnpm --filter @cradle/server check:boundaries

7. Run scoped lint and whitespace validation:

       pnpm exec eslint apps/server/src/modules/chat-runtime-providers/codex apps/server/src/modules/provider-runtime apps/server/src/modules/chat-runtime/runtime-session-context.ts apps/web/src/features/chat/context packages/chat-runtime-contracts/src/index.ts
       git diff --check

8. Run structural searches. Each removed symbol search must produce no
   production matches:

       rg -n "nativeHistory|previousNativeHistory|hydrateCodexNativeHistory|projectCodexEstimatedContextUsage" apps/server/src/modules/chat-runtime-providers/codex --glob '!*.test.ts'
       rg -n "const queue: CodexAppServerMessage\[\]|pendingNotificationsByThreadId" apps/server/src/modules/chat-runtime-providers/codex --glob '!*.test.ts'
       rg -n "JSON.stringify\(\[" apps/server/src/modules/chat-runtime/runtime-session-context.ts

9. Run the added non-gating diagnostic and save its concise output in this plan.
   The executor must name the final script/test command here when the artifact is
   added rather than leaving a placeholder.

## Validation and Acceptance

All conditions below must hold:

- A legacy snapshot containing one turn and one containing thousands of turns
  normalize to the same durable shape when their bounded native usage facts are
  equal. The persisted compact form contains neither turn content nor live UI
  projections.
- Resuming a legacy binding writes the compact form exactly once through the
  existing Drizzle directory. A second resume performs no write.
- Completing a normal Codex turn performs no `thread/turns/list` history
  hydration and still resumes the same native thread on the next turn.
- Codex detailed Context Usage is `null`. The visible meter uses native
  `last.totalTokens / modelContextWindow`, and cumulative totals are never shown
  as current occupancy.
- A notification updates a typed live projection without parsing or serializing
  the durable checkpoint. Terminal completion checkpoints the bounded native
  aggregate at most once for the final dirty revision. Releasing the last
  operation/UI owner removes that thread's live projection.
- Repeated UI-slot HTTP polls after initial host hydration issue zero native
  catalog/config calls until an explicit invalidation fact occurs.
- A blocked operation causes native notification delivery to stop with no
  accumulated payload array. Releasing/cancelling it removes the subscription.
- A pinned side conversation retains the host but has no subscriber until an
  active side turn begins.
- Concurrent root threads and registered descendants receive only their owned
  events. Unidentified non-global requests fail closed; synthetic request events
  preserve thread identity.
- A terminated native process generation cannot be reacquired. The next acquire
  creates and initializes a new generation exactly once.
- Focused server/web tests, both typechecks, module boundaries, scoped ESLint,
  and `git diff --check` pass.
- No database schema or migration file changed.

## Idempotence and Recovery

The legacy value migration is idempotent: decoding a current checkpoint and
encoding it again yields the same serialized value and does not advance the
dirty revision. If persistence fails, retain the in-memory compact checkpoint,
surface the existing binding persistence error, and retry the same compact
write; never restore the discarded history to the runtime session.

Host generation disposal and operation subscription close must be safe to call
more than once. Every acquisition or subscription added in a milestone must be
paired with `try/finally` before proceeding. Tests use deferred promises and
explicit aborts so they leave no timers or native processes.

Implement in small logical commits. If a later milestone fails, retain the
already verified native-history removal and value migration rather than
reintroducing the large snapshot. Do not use `git reset --hard` or overwrite
operator changes.

## STOP conditions

Stop and report instead of improvising if any of these occur:

- Live protocol evidence shows `ThreadTokenUsage.last.totalTokens` is not the
  current native context-window total. Include the exact generated/native
  payload that disproves the assumption.
- A production recovery path is found that consumes complete `nativeHistory`
  and cannot be replaced by `providerSessionId` resume without a user-visible
  loss. Do not substitute Chat transcript automatically.
- Another production provider currently registers or depends on the generic
  numeric snapshot migration map. Split the provider-owned codec migration into
  a prerequisite plan rather than colliding versions.
- Codex can emit a child-thread event before any protocol fact identifies its
  parent operation. Do not add recency, timing, or "only active session"
  inference; capture the protocol trace and request an ownership decision.
- Pausing native notification delivery necessarily deadlocks JSON-RPC responses
  or server requests even after follow-up RPCs are moved outside the delivery
  acknowledgement. Capture a minimal fake-client trace before considering a
  bounded byte channel; choosing a capacity is a product/operational decision,
  not an implicit heuristic.
- A user-visible surface requires historical tool/diff/terminal rows after the
  live operation owner ends and there is no authoritative paginated native API.
  Do not restore an unbounded snapshot array.
- An in-scope focused verification fails twice after a reasonable local fix, or
  the drift check finds overlapping operator work that cannot be preserved.

## Artifacts and Notes

Planning evidence at commit `4b092246`:

    Observed legacy Codex snapshot: 104.8 MB
    One parse + small rewrite: ~528 MB heap, ~971 MB RSS
    500 rewrites of a 5.7 MB snapshot: ~7.08 s CPU
    Context detail polling: 5 s while relevant
    UI slot polling: 2 s while active
    Native calls per current getUiSlotStates refresh: 12

During implementation, append concise focused test transcripts, the legacy
compaction before/after shape, and the final representative diagnostic here.
Do not paste full logs or large JSON payloads.

Implementation evidence (2026-08-12):

    Legacy shape: codex.nativeHistory.turns + live projections
    Durable shape: codex.durableVersion + codex.contextUsage only
    Structural fixture: 1 turn == 1,000 turns with 10,000-byte outputs
    Focused server: 6 files / 119 tests passed
    Adjacent writers: Claude state projector 5 passed; harness state 2 passed
    UI hydration: second unchanged getUiSlotStates call adds 0 native requests
    Host pressure: one-message pull-ahead test and early-bind ownership test passed

## Interfaces and Dependencies

Use existing generated Codex protocol types under
`codex/app-server-protocol/v2/`; do not create hand-written projections of
`ThreadTokenUsage`, `Turn`, or notification params. Use existing
`RuntimeCompactUiSlotState`, `RuntimeUiSlotState`, and provider snapshot envelope
types where they match ownership.

The following provider-owned interfaces or equivalent names must exist at the
end:

    interface CodexDurableCheckpointState {
      durableVersion: 1
      contextUsage: CodexNativeContextUsageCheckpoint | null
    }

    interface DecodedCodexDurableCheckpoint {
      checkpoint: WorkspaceProviderStateSnapshot & {
        codex: CodexDurableCheckpointState
      }
      didNormalize: boolean
    }

    interface CodexLiveThreadProjection {
      threadId: string
      // Existing typed current-state fields only; no Turn[] or unbounded feed.
    }

    interface CodexThreadOperationSubscription {
      readonly operationId: string
      bindRootThread(threadId: string): void
      bindDescendantThread(threadId: string, parentThreadId: string): void
      next(signal?: AbortSignal): Promise<CodexAppServerMessage | null>
      close(reason?: Error): void
    }

Provider Runtime remains the owner of binding persistence and host generations.
Codex remains the owner of its checkpoint codec, native protocol semantics, live
projection, and notification routing. Chat Runtime remains the owner of
transcript/events and the generic optional context-usage contract. The web
renderer consumes runtime-neutral compact/detail shapes and never parses Codex
state.

No new runtime dependency is required. Use TypeScript, the existing Elysia
routes, Drizzle-owned directory writes, Vitest fakes/deferred promises, and the
existing provider host manager.

## Revision note

2026-08-12: Initial combined plan created from the selected `$improve` findings.
It intentionally combines immediate native-history/Context Usage relief with
the durable/live state and host-pressure refactor so the same ownership debt is
not left behind in another form.
