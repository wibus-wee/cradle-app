# Plan 069: Demote the claude-agent state snapshot to a checkpoint — persist resume state only, rebuild the UI activity feed from authoritative history

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat cc3facef..HEAD -- apps/server/src/modules/chat-runtime-providers/claude-agent apps/server/src/modules/chat-runtime-providers/kit/state-snapshot.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Execution**: BLOCKED — the SDK transcript defaults to 30-day cleanup and omits provider activity facts needed for a lossless cold rebuild. Re-plan the activity feed over normalized Cradle `session_events`; transcripts may remain optional provider artifacts, not authority.
- **Priority**: P2
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: plans/065-claude-agent-sdk-integration-correctness.md, plans/066-claude-agent-live-query-config-and-history.md (correctness first — this plan restructures the code they patch). Coordinate with Plan 050 (Session projection authority) and Plan 061 (turn lifecycle): this plan assumes the chat event/message history is the authoritative record those plans establish; if they have not landed, treat Phase B read-path work as provisional and prefer Phase A only.
- **Category**: tech-debt / perf / architecture
- **Planned at**: commit `cc3facef`, 2026-07-26

## Why this matters

The provider's `providerStateSnapshot` blob conflates two kinds of state:
**(a) resume state** — small, bounded facts the provider needs to rebuild
itself (`pendingModelSwitchId`, `capturedPlan`, compact state, auth/rate-limit
status), and **(b) a UI activity feed** — unbounded derived projections
(`crewCalls`, `workflowExecutions`, `taskActivity`, alerts) whose facts
originate elsewhere (SDK transcript JSONL on disk, Cradle's event-sourced
chat history). Persisting (b) as a mutable blob inside (a) creates two
sources of truth that must be kept in sync by ~30 hand-written
`writeClaudeAgent*` mutators, each doing a full parse→mutate→serialize of the
whole blob per SDK event, persisted to SQLite ~3× per turn. Plan 065 caps the
arrays; this plan removes the second source of truth: (b) becomes a read
model rebuilt from authoritative history, and the blob keeps only (a) plus an
explicitly disposable bounded checkpoint.

The end state mirrors what the provider's own workflow subsystem already
does (`workflow/artifact-stream.ts`): a write-once JSONL journal
(`journal.jsonl` in the SDK transcript dir), a pure reducer
(`ClaudeWorkflowStateReducer`), and a subscription-based read model. That
file is the in-repo exemplar — match its ownership comment style.

## Current state

### Files (roles)

- `apps/server/src/modules/chat-runtime-providers/claude-agent/state-projector.ts` (905 lines) — all snapshot writers and read-side projectors. Snapshot interfaces: `ClaudeAgentPlanSnapshot` (:18), `ClaudeAgentProgressSnapshot` (:26), `ClaudeAgentAccountSnapshot` (:34), `ClaudeAgentAuthStatusSnapshot` (:45), `ClaudeAgentRateLimitSnapshot` (:53), `ClaudeAgentAlertSnapshot` (:59), `ClaudeAgentCrewCallSnapshot` (:568), `ClaudeAgentTaskActivitySnapshot` (:811).
- `apps/server/src/modules/chat-runtime-providers/kit/state-snapshot.ts` — `readWorkspaceProviderStateSnapshot` with `schemaVersion = 1` and a `registerProviderStateSnapshotMigration` mechanism.
- `apps/server/src/modules/chat-runtime-providers/claude-agent/workflow/artifact-stream.ts` (241 lines) — the exemplar: `ClaudeWorkflowArtifactSource` tails `journal.jsonl` / agent JSONL from the SDK transcript directory, reduces to a snapshot, publishes to subscribers.
- `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts` — reads: `getUiSlotStates` (:418), `listProviderThreads` (:1684), `readProviderThread` (:1729), `readClaudeSubagentMessages` (:2027) already rebuild provider-thread views from the SDK's on-disk JSONL transcripts (`resolveClaudeSessionProjectDir` :2010). Writers: the pump (`handleClaudeSessionMessage` :886) calls the `writeClaudeAgent*` functions.
- Web consumers read the feed via `getUiSlotStates` / capabilities — crew UI
  counts come from `projectClaudeAgentCrewUiSlotState` (state-projector.ts ~651).

### Excerpt A — a feed writer (state-projector.ts:585-607)

```ts
export function writeClaudeAgentCrewCall(
  runtimeSession: RuntimeSession,
  call: ClaudeAgentCrewCallSnapshot,
): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = { ...readRecord(snapshot.claudeAgent) }
  const existingCalls = readClaudeAgentCrewCallsSnapshot(claudeAgentState.crewCalls)
  const index = existingCalls.findIndex(c => c.id === call.id || (call.agentId !== null && c.agentId === call.agentId))
  if (index >= 0) { existingCalls[index] = mergeClaudeAgentCrewCall(existingCalls[index]!, call) }
  else { existingCalls.push(call) }
  claudeAgentState.crewCalls = existingCalls
  runtimeSession.providerStateSnapshot = JSON.stringify({ ...snapshot, claudeAgent: claudeAgentState })
}
```

Every feed write is a full-blob parse + upsert + stringify. The crew-call
record's facts (tool call id, agent id, prompt, status transitions) all
originate from SDK messages already flowing through the pump — and the SDK
persists the full session transcript (including subagent sidechains) as JSONL
under the session project dir, which `readClaudeSubagentMessages` already
parses for `listProviderThreads`.

### Field inventory (the basis for Phase A)

| Field | Kind | Authoritative source candidate |
|---|---|---|
| `capturedPlan`, `capturedProgress` | resume/UI hybrid — needed across restarts | Cradle message/event history (plan/progress are projected as chat content) |
| `pendingModelSwitchId` | resume state | **stays in blob** (Cradle-originated intent, not derivable from SDK transcript) |
| `accountSnapshot`, `authStatus`, `rateLimit` | volatile status | rebuildable on next `auth_status`/`rate_limit_event`; checkpoint optional |
| `alerts` (permission_denied) | feed (bounded 12) | SDK `permission_denied` events in transcript / Cradle events |
| `crewCalls` | feed (unbounded today) | SDK transcript JSONL (Task tool calls + sidechains) — same source `listProviderThreads` uses |
| `workflowExecutions` | feed (unbounded, carries rawInput/rawOutput/rawLifecycle) | workflow `journal.jsonl` + agent JSONL (artifact-stream.ts already reduces them) |
| `taskActivity` (todos) | feed (unbounded today) | latest todo-write tool calls in transcript |
| compact state, `pendingModelSwitchId`, interaction modes | resume state | **stays in blob** |

This table is the starting hypothesis, verified at `cc3facef`; Phase A Step 1
re-verifies every row against the live code and the SDK transcript contents
before anything is deleted.

### Conventions

- No DB schema change (AGENTS.md). The blob stays a text column; only its
  contents change. `registerProviderStateSnapshotMigration` in
  `kit/state-snapshot.ts` exists for exactly this shape change.
- Plan 065's array caps land first and remain as the checkpoint bounds.
- Baseline: claude-agent suite 17 files / 160 tests green (plus whatever
  065/066/067 add).

## Commands you will need

| Purpose | Command (run from repo root) | Expected on success |
|---|---|---|
| Typecheck server | `pnpm typecheck:server` | exit 0 |
| Module boundaries | `pnpm --filter @cradle/server check:boundaries` | exit 0 |
| Scoped tests | `pnpm vitest run apps/server/src/modules/chat-runtime-providers/claude-agent --reporter=dot` | all pass |
| Full server tests | `pnpm --filter @cradle/server test` | all pass |
| Lint | `pnpm lint` | exit 0 |

## Scope

**In scope**:

- `apps/server/src/modules/chat-runtime-providers/claude-agent/state-projector.ts` (split into writers-that-stay + projector-over-history)
- `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts` (read paths: `getUiSlotStates`, crew/task/workflow readers)
- New module(s) under `claude-agent/` for the feed projector (e.g. `projection/activity-feed.ts`), mirroring the `artifact-stream.ts` ownership style
- `apps/server/src/modules/chat-runtime-providers/kit/state-snapshot.ts` (one registered migration: drop feed arrays from the blob)
- `apps/server/src/modules/chat-runtime-providers/claude-agent/README.md` + `workflow/README.md` (architecture section)
- Colocated tests

**Out of scope**:

- `packages/db/**` — no schema change.
- Web apps (`apps/web`) — the `getUiSlotStates` contract stays identical; if a web change seems required, STOP.
- Other providers (codex/kimi/acp/opencode) — same disease, separate plan if this one proves the pattern.
- The live in-memory projection path during an active run (pump → UI slots) — it stays; this plan changes *persistence and cold-read*, not the hot path.

## Git workflow

- Branch: `advisor/069-claude-agent-snapshot-checkpoint`
- One commit per phase step; `refactor(claude-agent): ...` / `feat(claude-agent): ...`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Phase A — prove re-derivability, then delete nothing yet

#### Step 1: Re-derivability inventory (deliverable: a table in the PR/commit)

For every row of the field inventory above, verify against live code:
where does each fact first enter the system, and is it persisted in an
authoritative form (SDK transcript JSONL — check an actual session's project
dir under the claude config home; Cradle chat events — check what Plan 024's
event store records for provider messages)? Fields that check out get marked
"rebuildable". Fields that don't (expected: `pendingModelSwitchId`, compact
state, interaction modes) get marked "stays in blob".

**If a feed field is NOT rebuildable**: the correct action is to persist that
fact once, append-only, at the point it enters (an artifact file next to the
workflow journal, or a Cradle chat event if the runtime supports it) — never
as a mutable blob entry. Implement that write-once emission for the fields
that need it. If emitting requires touching chat-runtime contracts or DB,
STOP and report.

**Verify**: inventory table complete; every feed field is either "rebuildable
(from X)" or has a merged write-once emission path. Typecheck + scoped tests
green (emission is additive).

#### Step 2: Build the feed projector

New module `claude-agent/projection/activity-feed.ts`: pure functions that
take the authoritative sources (parsed transcript JSONL for a session,
workflow journal via the existing reducer) and return the same shapes the UI
consumes today (`ClaudeAgentCrewCallSnapshot[]`,
`ClaudeWorkflowExecutionRecord[]`, `ClaudeAgentTaskActivitySnapshot[]`,
alerts), bounded to the Plan-065 limits. Model the ownership comment and the
watcher/tail reuse on `workflow/artifact-stream.ts` (use `createJsonlTail`
from `infra/jsonl-tail` for incremental reads; do not re-read whole files per
request).

**Verify**: new colocated tests: feed a fixture transcript/journal through the
projector, assert the projected feed equals what the old blob writers would
have produced (build the fixture from an existing provider.test.ts scenario).

### Phase B — switch reads, shrink the blob

#### Step 3: Cold read path rebuilds; hot path unchanged

`getUiSlotStates` and any other read of the feed arrays: for a session with a
live Query, keep reading the in-memory projection (hot path). For a cold
session (no live entry — including after server restart), rebuild via the
Step-2 projector instead of reading `snapshot.claudeAgent.crewCalls` etc.

**Verify**: scoped tests: simulate cold session (no active entry) with a
fixture transcript on disk → `getUiSlotStates` returns the rebuilt crew/task
slots. Hot-path tests stay green unmodified.

#### Step 4: Stop writing the feed into the blob

Delete the feed-array writes from `writeClaudeAgentCrewCall`,
`writeClaudeAgentWorkflowExecution`, `writeClaudeAgentTaskActivity`,
`writeClaudeAgentPermissionDeniedSnapshot` — the in-memory projection for the
hot path is kept (these functions currently do both; split them: in-memory
map on the active entry for live sessions, no blob write). The blob keeps:
`capturedPlan`/`capturedProgress` (pending Phase-A verdict — if rebuildable,
they move too), `pendingModelSwitchId`, compact state, auth/rate-limit
checkpoint, interaction modes.

Register a migration in `kit/state-snapshot.ts` (`schemaVersion` 1 → 2) that
drops the removed keys on read, so old blobs load cleanly.

**Verify**: `pnpm typecheck:server` → 0; scoped tests green; a blob written
after this step contains no `crewCalls`/`workflowExecutions`/`taskActivity`
keys (assert in test).

#### Step 5: Raw payloads out of the feed

`ClaudeWorkflowExecutionRecord.rawInput/rawOutput/rawLifecycle` and crew-call
full `prompt`: these move to the workflow journal / transcript artifacts
(write-once, Step 1 emission) and are read from there on demand
(`readProviderThread`-style detail reads). List/slot projections carry ids
and previews only (the 120-char preview the UI actually uses).

**Verify**: scoped tests green; `grep -n "rawLifecycle" apps/server/src/modules/chat-runtime-providers/claude-agent/state-projector.ts` → no match.

#### Step 6: Docs + full pass

Update `claude-agent/README.md`: the snapshot is resume state + disposable
checkpoint; the activity feed is a read model over SDK transcripts and Cradle
history; Plan 065's caps are the checkpoint bounds. Then:
`pnpm typecheck:server`, `pnpm lint`,
`pnpm --filter @cradle/server check:boundaries`,
`pnpm --filter @cradle/server test` → all exit 0.

## Test plan

1. **Projector parity** (Step 2): fixture transcript → projected feed equals
   legacy blob-writer output for the same event sequence.
2. **Cold rebuild** (Step 3): no live entry → slots rebuilt from disk;
   `running` entries from an interrupted session project correctly.
3. **Blob shape** (Step 4): written blob has no feed keys; old v1 blob loads
   via the registered migration without error.
4. **Regression**: entire pre-existing suite (160+ tests) passes with
   assertions unchanged except tests that asserted blob-internal feed arrays
   (update those to assert via the projector).
5. **Bounded rebuild**: transcript fixture with 10× the cap of crew calls →
   projected feed respects the Plan-065 limits and flags truncation.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck:server`, `pnpm lint`, `pnpm --filter @cradle/server check:boundaries`, `pnpm --filter @cradle/server test` all exit 0
- [ ] `grep -n "claudeAgentState.crewCalls = " apps/server/src/modules/chat-runtime-providers/claude-agent/state-projector.ts` → no match (same for `workflowExecutions`, `taskActivity`)
- [ ] Re-derivability inventory table present in the final commit message or `claude-agent/README.md`, with every feed field marked
- [ ] `kit/state-snapshot.ts` has a registered v1→v2 migration
- [ ] Cold-session `getUiSlotStates` test passes reading only disk sources
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- A feed field's facts are NOT present in any authoritative store and emitting
  them write-once requires touching chat-runtime contracts or DB schema —
  that expands the blast radius beyond a provider-local refactor; report with
  the inventory row.
- The SDK transcript JSONL on disk proves to be pruned/rotated by the CLI in a
  way that loses history Cradle never persisted — cold rebuild would then be
  lossy; report the retention behavior found.
- Plans 050/061 change the read-path contracts (`getUiSlotStates`,
  capabilities) while this is in flight — re-base the read-path steps.
- Web fixtures or tests turn out to read the blob's feed arrays directly
  (search `apps/web` for `crewCalls`/`workflowExecutions`) — the UI must
  consume slots, not blob internals; report the leak.
- Any step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- After this lands, adding a new feed field means: add the fact to the
  authoritative source (or its write-once emission), extend the projector —
  never add a blob array. Reviewers should reject new `writeClaudeAgent*blob`
  feed writers.
- The same pattern applies to codex/kimi snapshot bloat; do not generalize
  until this one has run in production for a while.
- If cold-rebuild latency ever matters for very long sessions, the bounded
  window (Plan-065 caps) is the lever — do not reintroduce unbounded
  persistence to buy speed.
- `sessionStore` (SDK alpha) may eventually make even transcript parsing
  unnecessary; revisit when stable.
