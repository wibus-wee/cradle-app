# Plan 002: Expose committed chat-run activity to server plugins

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
>
> ```sh
> git diff --stat facc38f5..HEAD -- \
>   packages/plugin-sdk/src/server.ts \
>   packages/plugin-sdk/DEVELOPERS.md \
>   apps/server/src/modules/chat-runtime/es/event-tail.ts \
>   apps/server/src/plugins \
>   plugins/nowledge-mem/src/server.test.ts \
>   advisor-plans
> ```
>
> If any in-scope file changed after `facc38f5`, compare the "Current state"
> excerpts against live code before proceeding. Treat a semantic mismatch as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: direction / tech-debt / docs
- **Planned at**: commit `facc38f5`, 2026-07-29

## Why this matters

A personal WakaTime integration needs only a safe signal that a Cradle chat run
started or finished. The SDK already provides encrypted secrets, plugin storage,
outbound server-side `fetch`, logging, and lifecycle-owned disposables, but it
does not expose committed Chat Runtime activity. Its advertised chat hooks have
no runtime call sites, and its event bus is an untyped plugin-to-plugin channel
that receives no host activity.

Add one narrow, read-only subscription sourced from the canonical committed
`session_events` facts. This is an observation API, not an interception hook:
plugin work must never delay or alter Chat Runtime. Remove the unused hook
contract and public `string + unknown` bus in the same breaking refactor so the
SDK has one obvious mechanism for this job.

The public contract after this plan is:

```ts
type PluginActivity =
  | {
      kind: 'chat.run.started'
      occurredAt: number
      sessionId: string
      runId: string
      origin: 'user' | 'issue-agent' | 'system'
    }
  | {
      kind: 'chat.run.finished'
      occurredAt: number
      sessionId: string
      runId: string
      outcome: 'completed' | 'failed' | 'aborted'
    }

interface PluginActivitySubscription {
  subscribe(
    handler: (activity: PluginActivity) => void | Promise<void>,
  ): Disposable
}
```

`occurredAt` is a Unix timestamp in seconds, matching `session_events`.

## Product and semantic boundary

The host guarantees:

- Events are emitted only from stored `RunStarted`, `RunCompleted`,
  `RunFailed`, and `RunAborted` facts after their transaction commits.
- Delivery is live and best-effort. There is no replay or durable plugin cursor.
- Each subscriber's handlers are invoked synchronously in host publication
  order. Returned promises are observed for rejection but are not awaited and
  may overlap. Same-session invocation order follows the existing session
  actor. No cross-session ordering is promised because different session
  actors may commit concurrently.
- Existing session/global UI tail subscribers are notified before plugin
  activity is invoked. Plugin handlers are never awaited by Chat Runtime or
  by a different subscriber.
- Handler failures are caught and logged with the plugin owner; they do not
  break the delivery chain.
- Disposing the returned registration is synchronous and idempotent. It stops
  new delivery but neither cancels nor awaits a handler already in flight. The
  host disposes the registration automatically through `ctx.subscriptions`
  before awaiting plugin deactivation.
- Payloads contain only lifecycle metadata. Prompt text, response text, model,
  usage, tool calls, workspace paths, and errors are excluded.

The consuming plugin owns heartbeat timers, debounce/deduplication, async
serialization/backpressure, batching, network retries, WakaTime API errors,
and policy such as whether
`issue-agent`/`system` origins should count as personal activity.

## Current state

### Canonical facts and post-commit publication

- `apps/server/src/modules/chat-runtime/es/events.ts:15-22` defines the run
  lifecycle fact types.
- `apps/server/src/modules/chat-runtime/es/events.ts:75-86` carries the run ID,
  session ID, origin, and start timestamp on `RunStarted`.
- `apps/server/src/modules/chat-runtime/es/events.ts:135-144` carries run ID,
  session ID, terminal status, and finish timestamp on terminal facts.
- `apps/server/src/modules/chat-runtime/es/commands.ts:25-33` commits events in
  the session actor transaction and calls `publishSessionTailEvents` only after
  the transaction resolves.
- `apps/server/src/modules/chat-runtime/es/event-tail.ts:181-196` is the single
  live publication path used by ordinary commands and recovery. It receives
  full `StoredChatSessionEvent` batches after commit. Per-session order is
  serialized by the session actor; separate sessions may publish concurrently.
- `packages/db/src/schema/chat.ts:208-242` documents `session_events` as the
  append-only Chat Runtime fact log and gives each row a global autoincrement
  `sequenceId`.

The relevant event shapes are:

```ts
// apps/server/src/modules/chat-runtime/es/events.ts:75-86
export interface BackendRunStartedFact {
  id: string
  chatSessionId: string
  origin: 'user' | 'issue-agent' | 'system'
  startedAt: number
  // projection fields omitted
}

// apps/server/src/modules/chat-runtime/es/events.ts:135-144
export interface RunTerminalPayload {
  runId: string
  sessionId: string
  status: Exclude<ChatMessageStatus, 'streaming'>
  finishedAt: number
  // projection fields omitted
}
```

Use the stored event row's `occurredAt` and `aggregateId`; do not generate a
second timestamp. Do not expose `sequenceId`: this live-only API has no replay
or cursor contract, and `runId` already correlates start and finish.

### Plugin lifecycle and dead public surfaces

- `packages/plugin-sdk/src/server.ts:7-67` defines `ServerPluginContext`.
  `subscriptions` already owns automatic cleanup.
- `packages/plugin-sdk/src/server.ts:690-737` advertises mutable before-query
  hooks, after-response observation, and an untyped event bus.
- `apps/server/src/plugins/hooks.ts:6-74` stores hook handlers and exports
  runners, but repository-wide search finds no runner call sites.
- `apps/server/src/plugins/event-bus.ts:5-39` is a global
  `Map<string, Set<(unknown) => void>>`; repository-wide search finds no host
  event producers or real plugin consumers.
- `apps/server/src/plugins/context.ts:98-111` creates the event bus and the
  shared `track()` helper.
- `apps/server/src/plugins/context.ts:247-254` tracks hook registrations.
- `apps/server/src/plugins/context.ts:376-405` returns both dead surfaces on
  the plugin context.
- `apps/server/src/plugins/loader.ts:222-231` disposes tracked subscriptions in
  reverse order and clears the array.

The repository explicitly prefers clean breaking refactors over compatibility
shims (`AGENTS.md`). Delete the dead APIs; do not retain aliases, no-op methods,
or deprecated forwarding wrappers.

### Capability and permission convention

`apps/server/src/plugins/context.ts` registers owner-scoped runtime capability
records and tracks their disposables. `apps/server/src/plugins/runtime-registry.ts:214-257`
validates runtime registrations against the plugin's declared capability and
removes records on dispose.

The new subscription uses:

- runtime capability type: `activity-subscription`
- runtime capability local ID: `chat-runs`
- required manifest permission: `activity.read`

The developer guide must show this exact contribution:

```json
{
  "capabilities": [
    {
      "id": "chat-runs",
      "type": "activity-subscription",
      "layer": "server",
      "label": "Observe chat run activity",
      "permissions": ["activity.read"]
    }
  ],
  "permissions": [
    {
      "id": "activity.read",
      "label": "Read Cradle activity",
      "description": "Observe committed chat run lifecycle metadata.",
      "required": true
    }
  ]
}
```

Do not add WakaTime-specific names or permissions to the SDK.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| SDK build | `pnpm --filter @cradle/plugin-sdk build` | exit 0; declarations generated |
| Focused tests | `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/es/activity-tail.test.ts src/modules/chat-runtime/es/event-tail.test.ts src/plugins/activity-registry.test.ts src/plugins/context.test.ts src/plugins/developer-docs-boundary.test.ts src/plugins/runtime-registry.test.ts --reporter=dot` | all tests pass |
| Plugin mock test | `pnpm --filter @cradle/nowledge-mem exec vitest run src/server.test.ts --reporter=dot` | all tests pass |
| Server typecheck and boundaries | `pnpm --filter @cradle/server typecheck` | exit 0; boundary check passes |
| SDK typecheck | `pnpm --filter @cradle/plugin-sdk typecheck` | exit 0 |
| Lint changed code | `pnpm exec eslint packages/plugin-sdk/src/server.ts apps/server/src/modules/chat-runtime/es/activity-tail.ts apps/server/src/modules/chat-runtime/es/activity-tail.test.ts apps/server/src/modules/chat-runtime/es/event-tail.ts apps/server/src/modules/chat-runtime/es/event-tail.test.ts apps/server/src/plugins/activity-registry.ts apps/server/src/plugins/activity-registry.test.ts apps/server/src/plugins/context.ts apps/server/src/plugins/context.test.ts apps/server/src/plugins/developer-docs-boundary.test.ts apps/server/src/plugins/runtime-registry.test.ts plugins/nowledge-mem/src/server.test.ts` | exit 0 |
| Patch hygiene | `git diff --check` | no output, exit 0 |

Dependencies should already be installed in the managed worktree. Do not run an
install unless the package manager reports missing dependencies.

## Scope

**In scope** (the only production and test files to modify):

- `packages/plugin-sdk/src/server.ts`
- `packages/plugin-sdk/DEVELOPERS.md`
- `apps/server/src/modules/chat-runtime/es/activity-tail.ts` (create)
- `apps/server/src/modules/chat-runtime/es/activity-tail.test.ts` (create)
- `apps/server/src/modules/chat-runtime/es/event-tail.ts`
- `apps/server/src/modules/chat-runtime/es/event-tail.test.ts`
- `apps/server/src/plugins/activity-registry.ts` (create)
- `apps/server/src/plugins/activity-registry.test.ts` (create)
- `apps/server/src/plugins/context.ts`
- `apps/server/src/plugins/context.test.ts`
- `apps/server/src/plugins/developer-docs-boundary.test.ts`
- `apps/server/src/plugins/runtime-registry.test.ts`
- `apps/server/src/plugins/index.ts`
- `apps/server/src/plugins/README.md`
- `apps/server/src/plugins/hooks.ts` (delete)
- `apps/server/src/plugins/event-bus.ts` (delete)
- `plugins/nowledge-mem/src/server.test.ts`
- `advisor-plans/README.md` (status only)

**Out of scope**:

- A WakaTime plugin, API client, API key UI, heartbeat scheduler, or tests
- OAuth, Marketplace UX, install consent UX, or a generic integration framework
- Prompt/response content, model IDs, token usage, workspace paths, errors, or
  provider-native events
- Tool events such as `tool.completed`
- Replay, persisted cursors, filters, batching, backpressure, or a new database
  table/journal
- Behavior-changing hooks or interceptors
- Changes to Chat Runtime event schemas or `session_events`
- Web/Desktop plugin contexts or renderer UI

## Git workflow

- Stay on the operator-provided branch or Cradle-managed Work branch.
- Use the repository's conventional commit style, for example:
  `feat(plugin): expose committed chat run activity`.
- Do not push, open, ready, or merge a PR unless the operator or Cradle Work
  workflow instructs it.

## Steps

### Step 1: Replace the dead SDK surfaces with a typed activity contract

In `packages/plugin-sdk/src/server.ts`:

1. Add `PluginActivity`, `PluginActivityHandler`, and
   `PluginActivitySubscription` exactly as shown in "Why this matters".
2. Add `activities: PluginActivitySubscription` to `ServerPluginContext`, near
   `subscriptions`.
3. Delete `hooks`, `events`, and all hook/event-bus types:
   `ServerPluginHooks`, `ServerPluginChatHooks`, `BeforeQueryHandler`,
   `QueryHookContext`, `AfterResponseHandler`, `ResponseHookContext`, and
   `PluginEventBus`.
4. Keep `Disposable` as the registration lifetime type. Do not introduce a
   second unsubscribe shape.

Update the complete server-type reference and capability overview in
`packages/plugin-sdk/DEVELOPERS.md`. Replace the hook and event-bus examples
with one `ctx.activities.subscribe()` example. State the post-commit,
live-only, ordered, non-blocking, metadata-only semantics and show the exact
manifest contribution from this plan.

Update `apps/server/src/plugins/developer-docs-boundary.test.ts` so it asserts
that the guide contains `PluginActivitySubscription`,
`chat.run.started`, `chat.run.finished`, and `activity.read`, and does not
contain `ServerPluginHooks`, `PluginEventBus`, `ctx.hooks`, or `ctx.events`.

**Verify**:

```sh
pnpm --filter @cradle/plugin-sdk build &&
pnpm --filter @cradle/plugin-sdk typecheck
```

Expected: both commands exit 0 and `dist/server.d.ts` exposes
`activities.subscribe` plus the discriminated union, with no deleted hook or
event-bus types.

### Step 2: Translate committed run facts into one narrow internal broadcast

Create `apps/server/src/modules/chat-runtime/es/activity-tail.ts`.

It must:

1. Import `PluginActivity` as a type from `@cradle/plugin-sdk/server` and
   `StoredChatSessionEvent` from `./events`.
2. Own one process-local `Set` of synchronous internal subscribers.
3. Export a subscribe function returning `() => void`.
4. Export a publication function accepting
   `readonly StoredChatSessionEvent[]`.
5. Translate only these facts:
   - `RunStarted` -> `chat.run.started`, including
     `event.payload.run.origin`
   - `RunCompleted` -> `chat.run.finished` / `completed`
   - `RunFailed` -> `chat.run.finished` / `failed`
   - `RunAborted` -> `chat.run.finished` / `aborted`
6. Ignore every other stored fact.
7. Use `event.occurredAt`, `event.aggregateId`, and the fact's run ID directly.

Do not include `event.sequenceId` in `PluginActivity`; it remains internal to
the durable fact log.

The internal subscriber is synchronous. The plugin adapter invokes the public
handler immediately, observes any returned promise only for rejection, and
returns without awaiting it. Guard each internal subscriber call so a
synchronous adapter defect is logged and cannot abort publication. Do not
accept async internal subscribers or await plugin work in Chat Runtime.

In `apps/server/src/modules/chat-runtime/es/event-tail.ts`, call the activity
publication function exactly once at the end of
`publishSessionTailEvents(events)`, after the existing session and global UI
subscribers. Keep all existing commit/recovery call sites unchanged. This
preserves one post-commit fan-out point, keeps UI notification ahead of plugin
work, and avoids provider-specific instrumentation.

Create `activity-tail.test.ts` with table-driven tests for all four input facts,
plus a non-run fact. Assert exact public payloads, publication order across a
mixed batch, unsubscribe, and isolation when one internal subscriber throws.

Extend `event-tail.test.ts` with one wiring test that registers a UI tail
subscriber and an activity subscriber, publishes one `RunStarted` batch, and
asserts exactly one activity delivery after the UI subscriber ran. Do not infer
or test global ordering across separate sessions.

**Verify**:

```sh
pnpm --filter @cradle/plugin-sdk build &&
pnpm --filter @cradle/server exec vitest run \
  src/modules/chat-runtime/es/activity-tail.test.ts \
  src/modules/chat-runtime/es/event-tail.test.ts \
  --reporter=dot
```

Expected: all activity mapping tests and all pre-existing SSE tail tests pass.

### Step 3: Isolate plugin handlers behind the context lifecycle

Create `apps/server/src/plugins/activity-registry.ts`.

Export one owner-aware registration function used by `context.ts`. It must:

1. Register an owner-scoped `activity-subscription` capability with local ID
   `chat-runs`, label `Chat run activity subscription`, and declared candidate
   ID `chat-runs`.
2. Subscribe to the internal activity tail.
3. Invoke each handler immediately:

   ```ts
   try {
     Promise.resolve(handler(activity)).catch((error) => {
       logger.error('plugin activity handler failed', { plugin: owner, error })
     })
   }
   catch (error) {
     logger.error('plugin activity handler failed', { plugin: owner, error })
   }
   ```

   This preserves invocation order without creating an unbounded host queue.
   Returned promises may overlap; plugin code owns serialization and backpressure.
4. On dispose, mark the subscription disposed, unsubscribe from the internal
   tail, and remove the runtime capability record. An in-flight callback
   continues without being awaited or cancelled. Repeated disposal is a no-op.

Each live handler registration intentionally owns one capability record, just
like the current MCP/skill/hook registration pattern. Multiple subscriptions
are allowed and therefore may appear with the runtime registry's stable `#2`,
`#3` suffixes. Do not add a context-level refcounter or singleton manager merely
to collapse those records.

In `apps/server/src/plugins/context.ts`, expose:

```ts
activities: {
  subscribe(handler) {
    return track(registerPluginActivitySubscription(manifest.name, handler))
  },
}
```

Delete hook/event-bus imports, construction, and returned context properties.
Delete `apps/server/src/plugins/hooks.ts` and
`apps/server/src/plugins/event-bus.ts`; remove their exports from
`apps/server/src/plugins/index.ts`.

Update:

- `context.test.ts` to prove context registration is tracked, exposes the
  capability, receives start/finish invocations in publication order, isolates
  a rejected handler from another subscriber, and stops new delivery on
  disposal.
- `runtime-registry.test.ts` to use `activity-subscription:chat-runs`, rather
  than dead hook terminology, for its generic duplicate-ID test. Also add an
  external-local descriptor case proving that an undeclared activity
  registration is rejected, a matching capability without `activity.read` is
  rejected, and the exact declared `activity-subscription:chat-runs`
  registration is accepted.
- `plugins/nowledge-mem/src/server.test.ts` to replace its mock `hooks` and
  `events` fields with an `activities.subscribe` disposable.
- `apps/server/src/plugins/README.md` to name `activity-registry.ts`, explain
  committed metadata-only subscription and automatic disposal, and remove
  `hooks.ts`/`event-bus.ts` claims.

Do not add a compatibility object or retain the deleted files as forwarding
modules.

**Verify**:

```sh
pnpm --filter @cradle/plugin-sdk build &&
pnpm --filter @cradle/server exec vitest run \
  src/plugins/activity-registry.test.ts \
  src/plugins/context.test.ts \
  src/plugins/developer-docs-boundary.test.ts \
  --reporter=dot &&
pnpm --filter @cradle/nowledge-mem exec vitest run \
  src/server.test.ts \
  --reporter=dot
```

Expected: all focused host lifecycle/docs tests and the SDK context mock test
pass.

### Step 4: Run the complete static gates and prove old APIs are gone

Run the exact type, boundary, lint, and hygiene commands from "Commands you
will need".

Then run:

```sh
rg -n \
  'ServerPluginHooks|PluginEventBus|ctx\.hooks|ctx\.events|runBeforeQueryHooks|runAfterResponseHooks|emitPluginEvent|onPluginEvent' \
  packages/plugin-sdk apps/server plugins \
  --glob '!**/dist/**'
```

Expected: no matches.

Run:

```sh
rg -n \
  "chat\.run\.started|chat\.run\.finished|activity-subscription|activity\.read" \
  packages/plugin-sdk/src/server.ts \
  packages/plugin-sdk/DEVELOPERS.md \
  apps/server/src/modules/chat-runtime/es/activity-tail.ts \
  apps/server/src/plugins/activity-registry.ts
```

Expected: all four concepts are present in their owning SDK, docs, mapping, and
host adapter files.

## Test plan

Add focused non-component tests:

- `activity-tail.test.ts`
  - maps `RunStarted` including `origin`
  - maps completed, failed, and aborted terminals
  - ignores unrelated facts
  - preserves publication order within a batch
  - isolates a synchronously throwing internal subscriber
  - unsubscribe stops publication
- existing `event-tail.test.ts`
  - publishes exactly one activity from the real post-commit fan-out
  - invokes the existing UI subscriber before invoking plugin activity
- `activity-registry.test.ts`
  - callbacks are invoked in publication order without waiting for earlier async work
  - synchronous throws and rejected promises do not stop later events
  - one failing subscriber does not affect another
  - dispose leaves in-flight handlers alone, stops future callbacks, and is idempotent
  - capability record is added and removed with the registration
- existing `runtime-registry.test.ts`
  - external plugins cannot register an undeclared activity subscription
  - the exact declared capability/permission shape is accepted
- existing `context.test.ts`
  - `ctx.activities.subscribe()` is tracked in `ctx.subscriptions`
  - reverse lifecycle disposal removes the activity registration
- existing developer docs boundary test
  - new contract/documentation is present
  - dead public surfaces are absent
- existing Nowledge Mem server test
  - its complete `ServerPluginContext` fixture matches the breaking SDK shape

Do not add WakaTime tests or HTTP mocks.

## Done criteria

- [x] `ServerPluginContext` exposes only `activities.subscribe()` for host
  activity observation.
- [x] Only two discriminants exist: `chat.run.started` and
  `chat.run.finished`.
- [x] Activity is derived only from committed run lifecycle facts at the
  existing post-commit publication point.
- [x] Handler invocation follows publication order per subscriber without a
  host-owned async queue or false cross-session global-order guarantee, and
  cannot block Chat Runtime.
- [x] Rejections are isolated and lifecycle disposal stops delivery.
- [x] No prompt/response content, usage, model, tool, workspace, or error fields
  cross the SDK boundary.
- [x] Dead hooks and the untyped event bus are deleted with no compatibility
  shim.
- [x] SDK build/typecheck, focused tests, server typecheck/boundaries, lint, and
  `git diff --check` all pass.
- [x] `git status --short` shows no modifications outside the in-scope list
  (generated ignored build output is acceptable).
- [x] `advisor-plans/README.md` marks Plan 002 `DONE`.

## STOP conditions

Stop and report back; do not improvise if:

- Any production call site for `ctx.hooks`, `ctx.events`,
  `runBeforeQueryHooks`, `runAfterResponseHooks`, `emitPluginEvent`, or
  `onPluginEvent` has appeared since the planned commit.
- Run lifecycle facts no longer flow through `publishSessionTailEvents` after
  commit, including recovery paths.
- Satisfying the contract requires provider-specific instrumentation or a new
  database table.
- Runtime capability policy cannot express
  `activity-subscription:chat-runs` with `activity.read` under the current
  manifest model.
- Correct ordering would require awaiting plugin code from Chat Runtime.
- A focused verification fails twice after a reasonable correction.
- The implementation needs any out-of-scope file.

## Maintenance notes

- Reviewers should reject additions such as `tool.completed`, token usage, or
  transcript content until a concrete plugin proves the need and the canonical
  committed fact exists.
- Add an interceptor API later only for a real plugin that must change host
  behavior. It should have separate failure, timeout, ordering, and permission
  semantics; do not add mutation to `activities`.
- If durable delivery or a global cross-session order becomes a real
  requirement, design it separately over `session_events` with an explicit
  cursor and retention contract.
- A WakaTime plugin should keep its API key in `ctx.secrets`, configuration in
  `ctx.storage`, and network/timer state in its own namespace. None of those
  concerns belong in this SDK mechanism.
