# Plan 003: UI activity pipeline with Jarvis, analytics, and web plugin sinks

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
> git diff --stat f797608f..HEAD -- \
>   apps/web/src/features/activity \
>   apps/web/src/features/system-agent \
>   apps/web/src/features/product-analytics \
>   apps/web/src/lib/plugin-host.ts \
>   apps/web/src/app.tsx \
>   apps/web/src/app-providers.tsx \
>   apps/web/src/api-gen \
>   packages/plugin-sdk/src/web.ts \
>   packages/plugin-sdk/DEVELOPERS.md \
>   apps/server/src/modules/chat-runtime \
>   advisor-plans
> ```
>
> `apps/web/src/features/activity/` does not exist at the planned commit. If any
> in-scope file changed after `f797608f`, compare the "Current state" excerpts
> against live code before proceeding. Treat a semantic mismatch as a STOP
> condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none (Plan 002 server chat-run activity is orthogonal; do not
  require its files)
- **Category**: direction / product / plugin-sdk
- **Planned at**: commit `f797608f`, 2026-07-30
- **Review**: Grok plan review incorporated 2026-07-30 (privacy, entity
  resolution, idle resume, Jarvis consumer, observation body)

## Why this matters

WakaTime-style integrations and ambient Jarvis awareness both need the same host
signal: **what UI entity the user is on and how long they stayed there**. Server
`chat.run.*` activity (Plan 002, when merged) observes agent run lifecycle after
commit; it does not observe user presence in the renderer.

Build one renderer-owned activity pipeline with three built-in sinks on the same
bus:

1. **Jarvis ambient session** — persist metadata-only observation messages on
   segment end; consumed on the next Jarvis user send
2. **Product analytics** — privacy-safe `activity_segment_*` PostHog events
3. **Web plugin SDK** — typed `ctx.activities.subscribe()` for consumers such as
   a future WakaTime plugin

This is one product capability, one plan, one bus.

## Product and semantic boundary

### Host guarantees

- Segments are derived only from **entity changes** and **idle / hidden** in v1.
- Entity resolution prefers the **active browser-panel tab** when it carries a
  stronger entity than the route surface alone; otherwise use active surface +
  focused split-pane route.
- Segment events are **dispatched in host order**; subscriber handlers may be
  async but errors are isolated and never block other subscribers.
- Disposing a plugin registration stops new delivery; in-flight callbacks are
  not awaited or cancelled.
- **Two projections** of the same segment:
  - **Plugin/Jarvis projection** — full `entity` string (may include session
    ids, workspace-relative paths, plugin surface ids).
  - **Analytics projection** — privacy-safe allowlist only; never file paths,
    repo names, session/work ids, or raw entity strings (see Product analytics).

### V1 segment rules

**Entity switch** — when the resolved entity string changes, end the current
segment (`endReason: 'entity-changed'`) and start a new one.

**Idle** — when the same entity remains active but no entity switch occurs for
`IDLE_TIMEOUT_MS` (default **5 minutes**), end the segment (`endReason:
'idle'`).

**Idle resume** — after an idle-ended segment, if `document.visibilityState ===
'visible'` and the resolved entity is unchanged, **immediately start a new
segment** for that entity. This keeps `getCurrentSegment()` accurate for
WakaTime-style consumers without keystroke hooks.

**Hidden** — when `document.visibilityState !== 'visible'`, end the current
segment (`endReason: 'hidden'`). When visible again, start a fresh segment for
the current entity.

Do **not** in v1:

- extend segment duration on keystrokes or mouse input
- use composer focus, chat scroll attention, or `is_write`
- emit periodic heartbeats inside a segment (plugins own that)
- start Chat Runtime runs from activity injection

### Public contracts — plugin / internal bus

```ts
type UiActivityEvent =
  | {
      kind: 'ui.segment.started'
      occurredAt: number
      entity: string
      entityType: UiActivityEntityType
      previousEntity: string | null
    }
  | {
      kind: 'ui.segment.ended'
      occurredAt: number
      entity: string
      entityType: UiActivityEntityType
      durationMs: number
      endReason: 'entity-changed' | 'idle' | 'hidden'
    }

type UiActivityEntityType
  = | 'chat'
    | 'file'
    | 'settings'
    | 'pr'
    | 'diff'
    | 'kanban'
    | 'plugin'
    | 'work'
    | 'app'

interface UiActivitySubscription {
  subscribe(
    handler: (activity: UiActivityEvent) => void | Promise<void>,
  ): Disposable
  getCurrentSegment(): UiActivitySegment | null
}
```

`occurredAt` is Unix milliseconds in the renderer.

Web plugin manifest contribution:

```json
{
  "capabilities": [
    {
      "id": "ui-activity",
      "type": "activity-subscription",
      "layer": "web",
      "label": "Observe UI activity",
      "permissions": ["ui.activity.read"]
    }
  ],
  "permissions": [
    {
      "id": "ui.activity.read",
      "label": "Read UI activity",
      "description": "Observe user activity segment metadata (entity and duration only).",
      "required": true
    }
  ]
}
```

Plugins must declare the capability **and** receive operator/Marketplace grant for
`ui.activity.read` before `subscribe` succeeds. Reject undeclared or ungranted
registrations at the host boundary.

### Product analytics — privacy-safe projection only

Per `apps/web/src/features/product-analytics/README.md`, analytics must **not**
ship file paths, Cradle resource IDs, or raw entity strings. Add:

```ts
activity_segment_started: {
  entity_type: UiActivityEntityType
  previous_entity_type: UiActivityEntityType | null
}
activity_segment_ended: {
  entity_type: UiActivityEntityType
  duration_bucket: ProductAnalyticsDurationBucket
  end_reason: 'entity-changed' | 'idle' | 'hidden'
}
```

Implement mapping in `activity-analytics-sink.ts`; never pass plugin `entity`
strings into `trackProductEvent`.

Respect `useProductAnalyticsStore.enabled`, `productAnalyticsConfigured()`, and
**skip activity analytics in tearoff windows** (same policy as `app_opened` in
`product-analytics-runtime.tsx`).

### Entity resolution (v1)

Resolve on each tick in this order:

1. **Browser panel active tab** (`useBrowserPanelStore` / `browser-panel.ts`):
   - `workspace-file` → `entity = workspace-relative path`, `entityType = 'file'`
   - `workspace-diff` → `diff:{path}`, `entityType = 'diff'`
   - `pull-request` → `pr:{id}`, `entityType = 'pr'`
2. **Focused split pane route** when it differs from the surface primary route.
3. **Active surface route**:

   | Route / kind | Entity | `entityType` |
   |---|---|---|
   | `/chat/$sessionId` | `chat:{sessionId}` | `chat` |
   | `/work/$workId` | `work:{workId}` | `work` |
   | `/pull-requests` + search `workId` | `pr:{workId}` | `pr` |
   | `/settings/$section` | `settings:{section}` | `settings` |
   | `/kanban/$boardId` | `kanban:{boardId}` | `kanban` |
   | `/plugins/$routeSegment/$localId` | `plugin:{routeSegment}:{localId}` | `plugin` |
   | `/workspaces/$workspaceId` | `workspace:{workspaceId}` | `app` |
   | `home`, `new-chat`, `new-work`, `plugin-center`, `awaits`, `automation`, `usage`, `onboarding`, `devtool`, `diff`, `workspace-diffs` | `app:{surfaceKind}` | `app` |

Use `pluginSurfaceId(routeSegment, localId)` format from `surface-identity.ts`.

### Jarvis ambient session — write, filter, consume

**Create** one ambient session per renderer window:

- `workspaceId: null`
- `origin: 'jarvis-ambient'` (session module coarse origin; do not invent
  undeclared `jarvisRole` metadata)
- `runtimeKind`, `providerTargetId`, `modelId` from Jarvis preferences when
  creating the session
- Persist session id in localStorage; never add to `jarvis-ui-store.sessions`

**Filter** ambient sessions out of user-visible Jarvis history:

- Update `isJarvisHistorySession` in `jarvis-history-picker.tsx` to exclude
  `origin === 'jarvis-ambient'`

**Consume** on the next Jarvis user send:

- In `buildJarvisPromptText`, when `includeContext` is true, fetch the last
  `AMBIENT_OBSERVATION_LIMIT` (default **5**) observation messages from the
  ambient session and prepend them **before** the live `<cradle_context>` block
  assembled from `collectContextEnvelope()`.
- Live context assembly stays on send; ambient observations are a durable
  activity timeline, not a replacement for the envelope.

**Observation body** (metadata only — no `<cradle_context>`):

```text
[activity] segment ended: entity={entity} type={entityType} durationMs={n} endReason={reason}
```

**Jarvis sink rate limit (v1):** skip observation append when `durationMs <
MIN_OBSERVATION_DURATION_MS` (default **30 seconds**) to cap transcript growth.

## Current state

### Renderer context runtime (reuse, do not fork)

- `apps/web/src/features/context/context-items.ts` — `ContextEnvelope`
- `apps/web/src/features/context/context-registry.ts` — provider collection
- `apps/web/src/features/system-agent/use-context-snapshot.ts` —
  `collectContextEnvelope()`
- `apps/web/src/features/system-agent/context-assembler.ts` — budget assembly
- `apps/web/src/features/system-agent/format-context.ts` — `<cradle_context>`
- `apps/web/src/features/system-agent/jarvis-popover.tsx` — `buildJarvisPromptText`

### Entity sources

- `apps/web/src/navigation/surface-identity.ts`, `active-surface`
- `apps/web/src/features/split-view/store/split-workspace-store.ts`
- `apps/web/src/store/browser-panel.ts` — active workspace file / diff / PR tabs
- `apps/web/src/features/chat/context/chat-context.ts` — **not wired in v1**

### Jarvis sessions

- Footer tabs: `jarvis-ui-store.ts`; history filter: `jarvis-history-picker.tsx`
- Session `origin` owned by session module (`packages/db/src/schema/chat.ts`)

### Web plugin host

- `apps/web/src/lib/plugin-host.ts` — `validateWebRuntimeCapability`,
  `subscriptions` lifecycle

### Product analytics

- Privacy contract: `features/product-analytics/README.md`
- `trackProductEvent` in `client.ts`; tearoff skip in `product-analytics-runtime.tsx`

### Server message append without run

- `bang-command.ts` → `UserMessageAppended` without `RunStarted`

### Plugin activity registry pattern (inline; do not depend on Plan 002 files)

Mirror this handler isolation shape in `web-activity-registry.ts`:

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

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Web typecheck | `pnpm --filter @cradle/web typecheck` | exit 0 |
| SDK build | `pnpm --filter @cradle/plugin-sdk build` | exit 0 |
| SDK typecheck | `pnpm --filter @cradle/plugin-sdk typecheck` | exit 0 |
| Activity tests | `pnpm --filter @cradle/web exec vitest run src/features/activity --reporter=dot` | all pass |
| Analytics tests | `pnpm --filter @cradle/web exec vitest run src/features/product-analytics --reporter=dot` | all pass |
| System-agent tests | `pnpm --filter @cradle/web exec vitest run src/features/system-agent --reporter=dot` | all pass |
| Server tests | `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/observation-message.test.ts --reporter=dot` | all pass |
| Server typecheck | `pnpm --filter @cradle/server typecheck` | exit 0 |
| API gen | Regenerate web client from OpenAPI after server route (repo workflow) | `apps/web/src/api-gen` updated |
| Lint | `pnpm exec eslint` on touched TS/TSX | exit 0 |
| Hygiene | `git diff --check` | no output |

## Scope

**In scope**:

- `apps/web/src/features/activity/` (create)
- `apps/web/src/features/system-agent/jarvis-ambient-session.ts` (create)
- `apps/web/src/features/system-agent/activity-jarvis-bridge.ts` (create)
- `apps/web/src/features/system-agent/jarvis-popover.tsx` (ambient consume on send)
- `apps/web/src/features/system-agent/jarvis-history-picker.tsx` (filter ambient)
- `apps/web/src/features/product-analytics/event-model.ts`
- `apps/web/src/features/product-analytics/activity-analytics-sink.ts` (create)
- `apps/web/src/lib/web-activity-registry.ts` (create)
- `apps/web/src/lib/plugin-host.ts`
- `apps/web/src/app.tsx` or `app-providers.tsx`
- `apps/web/src/api-gen/*` (generated client for observation route)
- `packages/plugin-sdk/src/web.ts`, `DEVELOPERS.md`
- `apps/server/src/modules/chat-runtime/observation-message.ts` (create)
- `apps/server/src/modules/chat-runtime/observation-message.test.ts` (create)
- `apps/server/src/modules/chat-runtime/http/interaction.routes.ts`
- `apps/server/src/modules/chat-runtime/README.md`
- `advisor-plans/README.md` (status)

**Out of scope**:

- WakaTime plugin package (reference consumer in docs only)
- Plan 002 server `chat.run.*` implementation
- Chronicle, keystroke/`is_write`, git branch, language metadata
- Model runs triggered by activity
- Cross-window segment merging

## Steps

### Step 1: Web plugin SDK contract

Add types and `activities` to `WebPluginContext` in `packages/plugin-sdk/src/web.ts`.
Update `DEVELOPERS.md` with manifest, permissions, and contrast vs server
`activity.read` (Plan 002 when present).

**Verify**: SDK build + typecheck.

### Step 2: Activity engine + entity resolver

Create `features/activity/` per entity resolution and segment rules above.
Mount `ActivityRuntime` from app boot (not in tearoff for analytics; engine may
still run per-window).

Tests must cover: entity switch, idle + **idle resume**, hidden + visible resume,
browser-panel file tab precedence, subscriber isolation.

**Verify**: `vitest run src/features/activity`.

### Step 3: Built-in sinks

**3a Analytics** — privacy-safe properties only; tests assert no paths/ids in
payloads.

**3b Web plugin registry** — capability + permission enforcement; inline
isolation pattern above.

**3c Jarvis bridge** — metadata-only observation text; min duration gate; wire
after Step 4.

**Verify**: product-analytics + web-activity-registry tests.

### Step 4: Server observation append + OpenAPI

`appendSessionObservationMessage(sessionId, text)`:

- Eligible sessions: exist, not archived, local execution (reject
  `execution.kind === 'remote-host'`), `origin === 'jarvis-ambient'` **or**
  explicit allowlist for testing
- `UserMessageAppended` only; no `RunStarted`
- Message metadata: `metadata.cradle.observation = { kind: 'ui-activity', ... }`

Route: `POST /chat/sessions/:sessionId/observations` with TypeBox schema and
OpenAPI `detail`. Regenerate `apps/web/src/api-gen`.

**Verify**: observation-message tests + server typecheck + web typecheck.

### Step 5: Jarvis consume path + E2E wiring

1. `jarvis-ambient-session.ts` — create/resume ambient session with
   `origin: 'jarvis-ambient'`
2. `activity-jarvis-bridge.ts` — POST observations on segment end
3. `buildJarvisPromptText` — prepend recent ambient observations when
   `includeContext`
4. `jarvis-history-picker.tsx` — exclude `jarvis-ambient`
5. Update module READMEs

**Verify**: full command table + `rg` check for three sink families.

## Test plan

- Entity from browser-panel `workspace-file` tab, not workspace route search
- Idle ends segment; visible + same entity → new segment started
- Analytics payloads: only `entity_type`, `duration_bucket`, `end_reason` — never
  raw `entity`
- Plugin payloads: full `entity` allowed
- Ambient session excluded from Jarvis history filter
- `buildJarvisPromptText` prepends ambient observations + live envelope
- Observation append: no `backend_runs`; observation body has no
  `<cradle_context>`
- Capability denied without `ui.activity.read` grant
- Tearoff skips activity analytics

## Done criteria

- [ ] Segment bus with entity + idle/hidden + idle resume
- [ ] Privacy-safe analytics sink
- [ ] Web `ctx.activities` behind `ui.activity.read`
- [ ] Ambient session write + history filter + Jarvis send consume
- [ ] Observation API + generated web client
- [ ] All verification commands pass
- [ ] Plan 003 marked `DONE` in `advisor-plans/README.md`

## STOP conditions

Stop and report if:

- Analytics would require shipping resource IDs or file paths
- File-level segments require inventing workspace route search fields
- Ambient observations would appear in Jarvis history without filter
- Observation append requires `RunStarted` or triggers provider scheduling
- Idle leaves `getCurrentSegment()` null while visible on unchanged entity
- `ui.activity.read` cannot be granted through existing permission flow
- OpenAPI/client generation cannot be completed within scope

## Reference consumer (docs only)

```ts
// plugins/wakatime/src/web.tsx — not implemented in Plan 003
export function activate(ctx: WebPluginContext): void {
  ctx.activities.subscribe((event) => {
    if (event.kind === 'ui.segment.ended') {
      // plugin-owned heartbeat uses event.entity + getCurrentSegment()
    }
  })
}
```
