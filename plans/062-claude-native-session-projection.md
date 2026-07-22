# Plan 062: Claude Native Session Projection（以 SDK 会话为权威）

> **Executor instructions**: Execute milestones in order. This is an intentional
> breaking ownership refactor for the Claude Agent path. Prefer deleting wrong
> seams over adding compatibility heuristics. If a STOP condition occurs, stop
> and report. Update the Plan 062 row in `plans/README.md` when done.
>
> **Drift check (run first)**:
> `git diff --stat be474dca..HEAD -- apps/server/src/modules/chat-runtime-providers/claude-agent apps/server/src/modules/chat-runtime/queue apps/server/src/modules/chat-runtime/run/provider-synthetic-turn.ts apps/server/src/modules/chat-runtime/runtime-live-session-registry.ts apps/server/src/modules/chat-runtime/README.md apps/web/src/features/chat`
> If an in-scope file changed, compare it against the Current state section.
> A semantic mismatch in input-stream blocking, absorb/adopt, or synthetic-run
> ownership is a STOP condition until this plan is revised.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: Plan 061 (lifecycle admission / synthetic storm hardening) for safe UI Run creation; does **not** wait on Plan 061 UI work
- **Related**: `docs/exec-plans/20260701-01-claude-agent-runtime-refactor.md` (earlier SDK alignment; completed slices stay; this plan supersedes its queue/adopt/absorb narrative)
- **Category**: architecture, correctness, provider ownership
- **Planned at**: commit `be474dca`, 2026-07-21

## Why this matters

Claude Agent SDK already models a long-lived multi-turn session. Cradle currently wraps that session with a second turn scheduler: durable queue drain assumes one queue item maps to one native turn; mid-turn merges are guessed via `queued_command` text match and a 150ms settle; `completeClaudeSyntheticTurns()` can block the next `inputStream.push()`; post-result output opens UI Runs that are treated as if they owned the input channel.

The user-visible damage is not “missing a queue list.” It is incorrect blocking (follow-ups never reach the SDK), empty second runs, false Guide/absorb completions, and fragile cancel. The fix is ownership: Claude owns the live session and input queue; Cradle projects events into transcript and UI Runs.

## SDK design philosophy (non-negotiable)

This section is the product and engineering north star. Do not “improve” past it with Cradle heuristics.

### 1. One session = one long-lived Query

`query({ prompt: AsyncIterable<SDKUserMessage> })` is the Claude conversation process. It is not a one-shot RPC. Cradle already creates a reusable query per chat session and pumps `for await (const message of entry.query)`. **Keep that.** Do not revert to per-Cradle-run Query creation.

The Query owns:

- native input queueing
- whether multiple inputs coalesce into one native turn
- background work that continues after a top-level `result`
- cancel semantics via `interrupt()` / `cancelAsyncMessage(uuid)`

### 2. The AsyncIterable is an independent input channel

`streamInput` / the prompt iterable is the sole live user-input path. Comments in the SDK describe it as internal multi-turn plumbing. That implies:

- producers may push while the Query is emitting
- consumers of SDK output must not gate whether the iterable can accept the next message
- Cradle UI persistence (user bubble, synthetic/UI Run disk write) is **not** part of the input protocol

**Violation today:** awaiting `completeClaudeSyntheticTurns()` on the `streamTurn` reuse path before push/adopt.

### 3. Priority is native scheduling, not Cradle policy

`SDKUserMessage` supports `priority: 'now' | 'next' | 'later'`. Cradle may choose which priority to stamp when projecting a user action (e.g. live steer / queue follow-up as `'next'`), but **must not** reinterpret Claude’s response as a Cradle scheduler decision.

Claude may dequeue and coalesce multiple `'next'` inputs into one native turn. That is legal and expected. Cradle must model “one native turn, N submitted inputs,” never invent N one-to-one Cradle executions to match N queue rows.

### 4. `result` is a native turn boundary, not session death

A top-level `result` ends one Claude turn. The Query may continue. Later assistant messages, task notifications, and SubAgent activity remain events of the **same** Claude session.

Cradle may open a **new UI Run** to stream and persist a new visible assistant segment after that boundary. That UI Run is a projection container (SSE, message id, terminal commit). It is **not** permission to block the input stream, and it is **not** proof that a durable queue item “owns” that segment.

### 5. Interrupt / still_queued / cancelAsyncMessage are facts

- `query.interrupt()` cancels the in-flight native turn and reports what remains queued.
- `still_queued` means those input UUIDs will still execute (possibly coalesced). Cradle must surface that honestly.
- Per-input cancel uses `cancelAsyncMessage(uuid)` when the user cancels a specific submitted input that is still in the native queue.

Do not invent text-matching cancellation or “absorb” as a substitute for UUID identity.

### 6. Cradle’s job is projection, not turn scheduling

Cradle durable queue / UI queue is a **record of what the user submitted to Claude** (and local draft/reorder UX before or after submit). It is not the execution authority.

Cradle UI Run is a **streaming and persistence container** for a contiguous assistant output segment the product wants to show as a run. It is not Claude’s turn scheduler.

```text
User / Composer / Queue UI
        │
        ▼
  AsyncIterable push (uuid + priority)     ← input authority: Claude SDK
        │
        ▼
  long-lived Query
        │
        ▼
  pump: SDKMessage in arrival order
        │
        ├─ map into active UI Run chunks
        ├─ on need: open new UI Run (projection)
        └─ persist transcript / slots / provider threads
```

## Product decisions already accepted

1. **Keep** long-lived Query + AsyncIterable.
2. **Do not** let synthetic/UI Run completion block `inputStream.push()`.
3. **Post-result / background top-level assistant output may open a new Cradle UI Run.** From the UI’s perspective that *is* a new run. Reject the earlier “same timeline only, never a new run” proposal as product direction.
4. **Delete** the dual-owner reconcile layer: `completeClaudeSyntheticTurns` wait-before-push, adopt / `preAdoptBuffer` / absorbed, `queued_command` text match, 150ms settle, and the assumption one durable queue item = one Claude native turn.
5. If Claude coalesces multiple `'next'` inputs, Cradle must project **one native turn to multiple submitted inputs**, not fake multiple one-to-one runs.
6. Display-surface gaps (how merged inputs and UI Runs are labeled) are filled **as projection improves**, not by restoring heuristics. Refactor ownership first; grow presentation against the new model.

## Current state (evidence)

- Long-lived query + pump: `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts` (`streamTurn` creates/reuses entry; `pumpClaudeSessionQuery`).
- Input stream: `apps/server/src/modules/chat-runtime-providers/claude-agent/async-input-stream.ts` (default priority `'next'`).
- Block-before-push: `streamTurn` reuse path `await this.completeClaudeSyntheticTurns(activeEntry)` before push/adopt.
- Native follow-up map + absorb flags: `ActiveClaudeNativeFollowUp`, `enqueueNativeFollowUp`, `claimNativeFollowUp`, `preAdoptBuffer`, `markNativeFollowUpsAbsorbedFromSdkMessage` (text includes match on `queued_command` / queue-operation).
- Tentative absorb at `result` + clear via pre-adopt buffer.
- Drain settle: `apps/server/src/modules/chat-runtime/queue/drain.ts` `MID_TURN_ABSORPTION_SETTLE_MS = 150`.
- Registry mid-turn absorbed set: `runtime-live-session-registry.ts`.
- Post-result UI Run: `handleClaudeSyntheticSessionMessage` → `onProviderSyntheticTurnEvent` → `provider-synthetic-turn.ts` (keep as projection container; decouple from input gating).
- `interrupt()` / `still_queued`: not used by Claude provider today. `cancelAsyncMessage` is best-effort optional cast.

## Target architecture

### Session

One chat session with a live Claude Agent query has exactly one `ActiveClaudeQuery`: one SDK `query`, one `ClaudeAgentInputStream`, one pump.

### Input

Every user send, steer, and durable-queue submit that targets a live query:

1. Allocates / uses an SDK message UUID.
2. Pushes into the input stream with an explicit priority.
3. Records a Cradle durable “submitted input” row (queue item and/or transcript user message) keyed by that UUID when product needs durability/cancel UX.
4. **Never waits** on UI Run completion or synthetic finish to push.

When no live query exists, Cradle may create the query on first send, or keep the item as local pending until a query exists. Do not build a second execution queue that races the SDK.

### Output / UI Run

The pump always consumes SDK messages in order.

- If a Cradle UI Run is active for the current native segment, map chunks into it.
- If top-level assistant output arrives with no suitable active UI Run (including after a prior UI Run reached terminal because Claude emitted `result`), **open a new UI Run** (system or continuation origin as product requires) and project into it.
- Provider-thread / SubAgent traffic stays on provider-thread streams (`parent_tool_use_id`), not parent queue inventiveness.
- `task_*` notifications update slots/state; they do not by themselves create parent transcript Runs unless product explicitly decides otherwise (current README: they do not claim conversation ownership — keep unless product revises).

### Queue drain

Drain no longer means “schedule the next Claude turn.” After this plan:

- Live query path: submit already happened at enqueue time; drain’s job is projection bookkeeping (mark submitted rows completed when their UUIDs are observed consumed / when the native turn that included them ends), **without** opening empty Cradle runs to “adopt” them.
- No live query: drain may start a query + push, still without one-row-one-native-turn inventiveness beyond “these rows were pushed.”

Exact bookkeeping API can be designed in Milestone B; the invariant is: **SDK consume/coalesce is authoritative; Cradle does not guess with prompt text.**

### Cancel

- Cancel one submitted input still in native queue: `cancelAsyncMessage(uuid)`; update Cradle row from SDK outcome.
- Stop in-flight native turn: `interrupt()`; project `still_queued` into UI; do not claim those inputs were cancelled.
- Tear down session: abort + close input stream + close query (existing dispose path), after documenting interaction with still-queued inputs.

## Scope

**In scope**:

- `apps/server/src/modules/chat-runtime-providers/claude-agent/**` (especially `provider.ts`, README, tests)
- `apps/server/src/modules/chat-runtime/queue/drain.ts` and Claude-related absorb registry hooks
- `apps/server/src/modules/chat-runtime/runtime-live-session-registry.ts` mid-turn absorbed APIs (delete or narrow)
- Minimal Chat Runtime wiring so UI Run open/close does not gate provider input
- Docs: Claude provider README + chat-runtime README steer/queue sections
- Focused tests proving push is not blocked by synthetic/UI Run completion; proving no text-match absorb path remains

**Out of scope (follow-on display work)**:

- Full web redesign of queue badges / merged-input chrome (add thin labels only if needed for acceptance)
- Codex / Kimi / ACP ownership changes
- DB schema migrations unless UUID correlation literally cannot be stored in existing queue metadata (prefer existing fields / event payload first; STOP if schema seems required)
- Replacing Plan 061’s admission/serialization work for UI Run storms (compose with it: projection Runs still need single admission owner)

## STOP conditions

- Reintroducing prompt-text matching to correlate queue rows with Claude turns
- Reintroducing settle timers to choose absorb vs separate turn
- Blocking `inputStream.push` on UI Run / synthetic completion
- Claiming one durable queue item must equal one native Claude turn
- Deleting post-result UI Runs entirely “because projection” (conflicts with accepted product decision)
- Expanding scope into Codex scheduler redesign

## Plan of work

### Milestone A — Philosophy lock + characterization

Write/keep this plan as the authority. Add failing or characterizing tests that encode:

1. While a synthetic/UI Run publish path is slow or pending, a follow-up `push(..., { priority: 'next' })` still reaches the mock SDK input stream.
2. Current absorb/adopt behavior is documented as deprecated (tests may still pass until Milestone C deletes them).

Update Claude README with the philosophy section summary (session/query/input/result/UI Run).

Acceptance: README states the boundary; characterization test exists for non-blocking push.

### Milestone B — Decouple input channel from UI Run lifecycle

Remove `await completeClaudeSyntheticTurns(...)` from the hot path before push. Completing open projection Runs may still happen, but must not serialize the AsyncIterable.

Ensure pump remains non-blocking for synthetic publish (already fire-and-forget in places); align streamTurn reuse with that rule.

Wire cancel path notes for `interrupt` / `still_queued` (implementation can land in C if needed, but API surface should not pretend absorb is cancel).

Acceptance: characterization test from A passes for real code path; no await of synthetic completion before push in `streamTurn`.

### Milestone C — Delete dual-owner reconcile

Delete or gut:

- `preAdoptBuffer` adopt path as scheduler
- `absorbedMidTurn` / registry mid-turn absorbed set / drain 150ms settle / `completeAbsorbedMidTurnQueueItem` Claude special-case
- `markNativeFollowUpsAbsorbedFromSdkMessage` text matching
- Tentative absorb-all-pending-at-result

Replace with UUID-keyed submitted-input tracking. When Claude coalesces, complete multiple Cradle submitted rows against one native turn boundary without opening empty user runs.

Keep post-result **UI Run** creation as projection (`provider-synthetic-turn` or renamed clearer “projection run” later). Compose with Plan 061 admission rules.

Acceptance: no 150ms Claude absorb settle in drain; no queued_command prompt matching in provider; provider tests updated; queue follow-up while busy still reaches SDK without requiring a second empty Cradle run inventiveness.

### Milestone D — Projection + thin display

Ensure transcript/UI Run behavior:

- Live steer still appears as Guide without a second user-run when product says steer.
- Coalesced queue submits appear as submitted user inputs correlated to the UI Run(s) that streamed the native turn output (exact chrome can be minimal).
- Post-result assistant output opens a new UI Run and streams normally.
- Cancel UX: cancelled UUID disappears or shows failed cancel; interrupt leaves still_queued visible if implemented.

Acceptance: focused provider + queue tests green; manual or integration note in plan Outcomes for one busy-follow-up and one post-result UI Run scenario.

## Concrete verification commands

Working directory: repository root.

    pnpm --filter @cradle/server typecheck

    pnpm --filter @cradle/server exec vitest run \
      src/modules/chat-runtime-providers/claude-agent/provider.test.ts \
      src/modules/chat-runtime/queue \
      --maxWorkers=1

    pnpm --filter @cradle/server exec vitest run \
      tests/turn-executor.test.ts \
      tests/chat-runtime-recovery.test.ts \
      --maxWorkers=1

    git diff --check

Expected: exit 0 on all; no reintroduction of absorb settle helpers.

## Idempotence and recovery

Each milestone should leave the tree buildable. If Milestone C is half-finished, do not ship a tree that both text-matches and UUID-tracks; finish delete or revert. UI Run projection must remain available so background assistant output does not vanish mid-migration.

## Artifacts and notes

Primary files:

- `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts`
- `apps/server/src/modules/chat-runtime-providers/claude-agent/async-input-stream.ts`
- `apps/server/src/modules/chat-runtime-providers/claude-agent/README.md`
- `apps/server/src/modules/chat-runtime/queue/drain.ts`
- `apps/server/src/modules/chat-runtime/runtime-live-session-registry.ts`
- `apps/server/src/modules/chat-runtime/run/provider-synthetic-turn.ts`

Naming note: “synthetic turn” in code today means “UI Run opened without a user-origin Cradle send.” After this plan it should be understood as **projection UI Run**, not “fake Claude turn.” A rename is optional cleanup, not required for correctness.

## Progress

- [x] (2026-07-21) Philosophy and ownership boundary agreed in design discussion (long-lived Query kept; UI Run allowed for post-result; dual-owner absorb/adopt rejected).
- [x] (2026-07-21) Plan 062 written.
- [x] (2026-07-21) Milestone A — Documented native session ownership and added the non-blocking synthetic persistence characterization.
- [x] (2026-07-21) Milestone B — Detached projection-Run completion from `inputStream.push()` and kept synthetic publishing off the pump's awaited path.
- [x] (2026-07-22) Milestone C — Replaced absorb/adopt/text matching with exact SDK UUID submission and `msg_lifecycle_v1` command terminal facts, native-first cancel, and `interrupt()` / `still_queued` preservation.
- [x] (2026-07-22) Milestone D — Kept post-result projection UI Runs, persisted multiple submitted inputs for one native turn, and documented queue/Run display ownership.

## Surprises & Discoveries

- Observation: Red tests that prove blocked push validate the **input channel bug**, not a full alternate driver design. Do not treat them as proof that a previous “complete driver” proposal already matched the SDK.
- Observation: Plan 061 addresses UI Run admission storms; this plan addresses Claude session ownership. Both can keep post-result UI Runs; only this plan forbids using those Runs as input gates or native-turn counters.
- Observation: Before this refactor, `interrupt()` / `still_queued` were unused in the Claude provider; cancel honesty required preserving the long-lived Query rather than closing it.
- Observation: Live Claude Code 2.1.207 does not replay ordinary streaming-input user UUIDs on SDK output because the SDK does not launch the CLI with `--replay-user-messages`. The initial implementation's user-echo/result completion assumption therefore left rows stuck and made teardown capable of duplicate resubmission.
- Observation: The same live CLI advertises `msg_lifecycle_v1` and emits exact `command_lifecycle` events with the submitted UUID in `command_uuid`. Observed states include `queued`, `started`, and terminal `cancelled`; the binary protocol declares terminal `completed`, `failed`, and `cancelled`. These structured facts supersede the user-echo model.
- Observation: `@anthropic-ai/claude-agent-sdk` 0.3.207 forwards `command_lifecycle` but omits it from its `SDKMessage` declaration. Cradle carries a narrow observed-wire union until the upstream type surface includes the event.

## Decision Log

- Decision: Retain long-lived Query + AsyncIterable as the Claude multi-turn mode.
  Why: Explicit SDK multi-turn design; already partially implemented.
- Decision: Post-result top-level assistant output may open a new Cradle UI Run.
  Why: Product/UI treats that segment as a new run; the earlier “same timeline only” proposal was rejected.
- Decision: Delete absorb/adopt/text-match/150ms reconcile instead of improving heuristics.
  Why: Dual ownership; not an SDK correlation protocol; `result` has no user-UUID field to hang guesses on.
- Decision: Durable queue becomes submitted-input record, not execution authority.
  Why: SDK allows queueing and coalescing; Cradle must project that, not reschedule it.
- Decision: `msg_lifecycle_v1` command UUID terminal states are the durable-row completion authority; `result` is never one.
  Why: Live CLI output disproved user-echo correlation and exposed the exact feature-gated lifecycle protocol.
- Decision: Refactor ownership before large display work; grow display against the new model.
  Why: Display gaps caused the fake scheduler; filling display without ownership fix recreates heuristics.

## Outcomes & Retrospective

- One chat session still owns one long-lived Query and continuous input iterable. Reused-query input now reaches the SDK while an earlier synthetic UI Run is blocked in persistence; projection completion is detached and the pump never awaits `waitForRunCompletion`-shaped work.
- Durable queue row IDs are stamped directly as SDK message UUIDs. Exact `msg_lifecycle_v1` `command_uuid` states own submission and terminal bookkeeping; `result` never completes a row. Coalesced native turns may terminally settle multiple command UUIDs without creating one-row Runs.
- Live CLI verification corrected the first implementation before delivery: Claude Code 2.1.207 emitted no input user echo, but did emit `command_lifecycle(queued → started → terminal)` and advertised both `msg_lifecycle_v1` and `interrupt_receipt_v1`. Native submit now fails closed without the lifecycle capability. On teardown, only explicitly queued inputs are eligible for automatic retry; started or unacknowledged inputs become failed to prevent duplicate side effects.
- Queue drain waits while a live Query owns a UUID and wakes on native completion facts. It no longer creates an adopt Run, uses a settle timer, or spins while waiting. Post-result top-level output still opens a projection UI Run through the existing Plan 061 admission path.
- Per-input cancel changes the durable row only after `cancelAsyncMessage(uuid)` returns `true`. Current-turn stop calls `interrupt()` without closing the Query, and known `still_queued` UUIDs remain tracked as inputs that will execute.
- Focused verification passed: Claude provider + queue + ES tests (103), turn executor + recovery tests (12), module boundaries, forbidden-helper scan, and `git diff --check`. Full server TypeScript validation is currently blocked only by two pre-existing `provider-catalog/catalog.test.ts` Codex mocks missing the newly required `pid` field; no Plan 062 file reports a type error.
