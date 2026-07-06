# Plan 025 — Authoritative usage fields per runtime provider

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Principle**: Cradle must **not invent token totals**. At run finalization, persist exactly the upstream SDK / app-server **authoritative final usage** for that user-visible run. Dashboard aggregation (`usage_logs` → daily/summary/cost) stays as-is; fixes belong at the provider → `insertRunUsage` boundary.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MEDIUM — changes billing-adjacent numbers users may already trust; add regression tests per provider.
- **Depends on**: —
- **Category**: correctness / observability
- **Planned at**: 2026-07-06

## Why this matters

Users compare Context Usage UI, Usage Dashboard, and provider account pages. Mismatches trace to:

1. **Wrong field** — e.g. Codex app-server exposes `tokenUsage.total` and `tokenUsage.last`; we persist `last`.
2. **Wrong moment** — e.g. AI SDK emitter takes the **first** usage event, not the final `result.usage`.
3. **Self-aggregation** — Claude Agent sums stream events instead of trusting a single final SDK payload when one exists.
4. **Not captured** — cancelled runs skip `insertRunUsage`; side threads (title gen, subagents) never attach to the parent run.

This plan defines the **authoritative field contract** and the minimal code changes to honor it.

## Persistence contract (unchanged shape)

| Layer | Responsibility |
| ----- | -------------- |
| **Provider** | Expose run-final billable `TokenUsage` via `ChatRuntime.totalUsage` (preferred) or `lastUsage` when upstream only has one field. |
| **`turn-executor`** | `const usage = runtime.totalUsage ?? runtime.lastUsage` → `insertRunUsage` (one row per completed, non-cancelled run). |
| **`usage` module** | Read-model over `usage_logs`; no provider logic. |
| **`step_usage`** | Optional diagnostic granularity; **not** the Dashboard source of truth unless explicitly promoted later. |

### `TokenUsage` mapping rules

| Upstream field | Cradle field |
| -------------- | ------------ |
| `input_tokens` / `inputTokens` / `input` | `promptTokens` |
| `output_tokens` / `outputTokens` / `output` (+ `reasoning` when upstream splits it) | `completionTokens` |
| `total_tokens` / `totalTokens` / `total` | `totalTokens` (else `prompt + completion`) |

**Cached / reasoning breakdown**: persist in `step_usage` or observability snapshots when available; `usage_logs` stays the three aggregate ints unless schema changes (out of scope).

---

## Authoritative usage by provider

### Summary table

| Runtime | Upstream source | Authoritative field | Current Cradle read | Status |
| ------- | ----------------- | ------------------- | ------------------- | ------ |
| **codex** | `thread/tokenUsage/updated` → `ThreadTokenUsage` | **`tokenUsage.total`** (turn-cumulative per app-server) | `readCodexLastTokenUsage` → **`tokenUsage.last`** | **BUG** |
| **claude-agent** | Claude Agent SDK stream | **Final `result` message `usage`** when present; else sum of per-API-call usage events if SDK documents them as non-overlapping | Manual sum of all stream usage into `_totalUsage` | **REVIEW** |
| **openai-compatible** | AI SDK `streamText` | **`await result.usage`** at stream end (cumulative for the turn) | First `finish` / `onUsage` only (`emitted` guard) | **BUG** (multi-step / early finish) |
| **opencode** | OpenCode `message.updated` (assistant) → `message.tokens` | **Terminal assistant message** for the prompt turn (`input`, `output + reasoning`) | Last projector `usage` at async close | **OK** (verify one terminal message = one turn) |
| **system-agent** | jar-core ingress `result.usage` | **`result.usage`** at turn end | `captureResultUsage` → `_lastUsage` | **OK** |
| **acp** | ACP `PromptResponse.usage` | **`response.usage`** after `prompt` completes | `toTokenUsage(promptResult)` at stream end | **OK** (cancel deletes usage — see gaps) |
| **mock-claude-agent** | Test double | Mirror claude-agent contract | `lastUsage` only | **TEST ONLY** |

### Codex (`runtimeKind: codex`)

**Protocol** (`ThreadTokenUsage`):

```ts
{ total: TokenUsageBreakdown, last: TokenUsageBreakdown, modelContextWindow }
```

| Field | Semantics (per app-server + existing tests) |
| ----- | ------------------------------------------- |
| `total` | Cumulative tokens for the thread/turn context — used by compact UI and context usage |
| `last` | Most recent single API call within the turn |

**Authoritative for `usage_logs`**: `tokenUsage.total` from the **last** `thread/tokenUsage/updated` for the active turn before/at `turn/completed`.

**Already correct elsewhere**: `projectCodexCompactSnapshot` stores full `tokenUsage`; `ui-slot-projector` / `context-usage-projector` read `total`.

**Target implementation**:

- Add `readCodexTotalTokenUsage(tokenUsage)` parallel to `readCodexLastTokenUsage`.
- Provider exposes `get totalUsage()` from latest notification's `total` (or compact snapshot at stream end).
- Keep `lastUsage` as `last` for debugging / context meter if needed.
- Finalize prefers `totalUsage` (existing `turn-executor` path).

**Regression test**: extend `provider.test.ts` token-usage case — assert `provider.totalUsage` matches `tokenUsage.total`, and a turn-executor integration test (or provider finalize hook test) would persist 128k not 4k.

---

### Claude Agent (`runtimeKind: claude-agent`)

**Upstream**: SDK stream messages — `stream_event` (`message_delta.usage`), assistant messages, terminal `result.usage`.

**Authoritative for `usage_logs`**: Prefer **one** SDK-provided turn total:

1. If terminal `result` message includes `usage` representing the **full query/turn**, use only that.
2. If SDK documents each usage event as **one API round-trip increment** (multi-tool loop), sum is valid — but must be validated against real SDK docs / captured traces, not unit mocks alone.

**Current**: `updateClaudeTurnUsage` sums every mapped usage — `totalUsage` in tests is sum of `message_delta` + `result` (185 tokens).

**Target implementation**:

- Read Claude Agent SDK docs / sample traces for whether `result.usage` is cumulative for the whole turn.
- If cumulative: set `_totalUsage` from final `result` only; stop summing `message_delta`.
- If incremental per API call: keep sum but **exclude** duplicate cumulative `message_delta` if present.
- Expose `totalUsage` getter (already exists); ensure finalize uses it.

**Regression test**: add fixture based on real SDK capture (not only synthetic increments) once semantics confirmed.

---

### OpenAI-compatible / AI SDK (`runtimeKind: openai-compatible`)

**Upstream**: Vercel AI SDK `streamText` → `StreamTextResult.usage` (Promise, cumulative) and/or `finish` part `totalUsage`.

**Authoritative for `usage_logs`**: **`await result.usage`** after the UI stream drains.

**Current issues**:

- `createUsageEmitter` sets `emitted = true` on first usage — may record partial step.
- `openai-compatible` sets `maxSteps: 1` today — masks the bug for standard chat.
- `onStepFinish` → `lastStepUsages` → `step_usage` only; not rolled into `usage_logs`.

**Target implementation**:

- Remove or invert emitter priority: always prefer final `await result.usage`.
- Optionally set `_totalUsage` from `result.usage` in provider for explicit contract.
- If `maxSteps > 1` is enabled later, `totalUsage` must come from `result.usage`, not first step.

**Regression test**: `ai-sdk-engine.test.ts` — multi-step mock where first finish usage ≠ final `result.usage`; assert provider persists final.

---

### OpenCode (`runtimeKind: opencode`)

**Upstream**: `message.updated` with `role: assistant` → `tokens: { input, output, reasoning }`.

**Authoritative for `usage_logs`**: Token counts on the **terminal assistant message** that closes the async prompt turn (`closeAsyncPromptTurn` / history recovery).

**Current**: `OpencodeEventStreamProjector.usage` updated on each assistant `message.updated`; finalize copies projector at close — effectively last assistant state.

**Target**: Document as pass-through; add test that multi-assistant-turn only bills terminal message if that matches OpenCode semantics. If OpenCode exposes a turn-level total elsewhere, switch to that (STOP and report if discovered).

---

### System Agent (`runtimeKind: system-agent`)

**Upstream**: `MessageIngressResult.usage` after jar-core turn.

**Authoritative**: `result.usage` — already `captureResultUsage`.

**Action**: None beyond contract doc.

---

### ACP (`runtimeKind: acp`)

**Upstream**: `PromptResponse.usage` after `connection.prompt` completes.

**Authoritative**: `response.usage` — already `toTokenUsage(promptResult)`.

**Gap**: Cancel path deletes `usageBySessionKey` → no `usage_logs` row (see below).

---

## Intentionally out of scope for pass-through (document, don't silently fix)

| Scenario | Behavior today | Product decision needed |
| -------- | -------------- | ----------------------- |
| User **cancel** mid-run | `insertRunUsage` skipped | Bill partial usage from last known authoritative snapshot? |
| Codex **title generation** thread | Separate ephemeral thread; not linked to main run | Roll into session totals or separate metric? |
| Codex **subagent / crew** threads | Own `thread/tokenUsage/updated` on child threads | If `total` on parent already includes children, OK; else aggregate? |
| **Failed** run before finalize | Often no usage row | Persist partial if upstream emitted usage? |
| **Provider account** diagnostics | Codex `account/tokenUsage/read` etc. | Different namespace — not `usage_logs`; document in UI |

Until decided, spec says: **only completed, non-cancelled main runs** get a row; partial/side traffic is observability-only (`step_usage`, snapshot events).

---

## Implementation steps

### Step 1: Codex — persist `tokenUsage.total`

- Add `readCodexTotalTokenUsage` in `state-projector.ts`.
- `CodexProvider`: track `_totalUsage` from `total`; keep `_lastUsage` from `last`.
- Tests: `provider.test.ts` asserts `totalUsage`; add server test that seeded finalize path writes correct totals.

**Verify**: `pnpm --filter @cradle/server test codex/provider` and `usage.test`

### Step 2: AI SDK — final `result.usage` wins

- Change `createUsageEmitter` / `executeAiSdkTurn` to await `result.usage` after stream loop.
- `OpenAICompatibleProvider`: optional `totalUsage` getter from final result.

**Verify**: `pnpm --filter @cradle/server test ai-sdk-engine`

### Step 3: Claude Agent — align with SDK semantics

- Spike: one real trace or SDK doc citation for `result.usage` scope.
- Adjust `updateClaudeTurnUsage` per findings (single final vs incremental sum).
- Update `provider.test.ts` with documented semantics.

**STOP**: If SDK docs ambiguous, pause and attach trace evidence before changing sum behavior.

### Step 4: Contract documentation

- Update `apps/server/src/modules/usage/README.md` with pointer to this plan.
- Update `apps/server/specs/capabilities/usage-tracking.md` — write path is `turn-executor` + `insertRunUsage`, not `chat.message-completed` subscriber (stale spec).

**Verify**: docs only

### Step 5 (optional): Observability

- Ensure `recordSnapshotEvent` `payload.source` reflects `runtime.totalUsage` vs `runtime.lastUsage` after fixes (already partially present).

---

## Done criteria

- [ ] Codex `usage_logs` row uses `tokenUsage.total` for multi-step turns (test proves 128k not 4k case)
- [ ] AI SDK path persists final `result.usage`, not first stream finish only
- [ ] Claude path documented with explicit authoritative field choice
- [ ] Summary table in this plan matches code
- [ ] `usage-tracking.md` spec corrected for write path
- [ ] `plans/README.md` row updated

## STOP conditions

- OpenCode or ACP upstream lacks a single turn-total field and multi-message billing is ambiguous — STOP, report, do not guess.
- Changing Claude sum logic without SDK evidence — STOP at Step 3.
- Product requests billing cancelled/partial runs — STOP and split into a follow-up plan.

## Maintenance notes

- Dashboard SQL (`usage/service.ts`) needs no change if provider boundary is fixed.
- `step_usage` remains diagnostic; promoting it to Dashboard source requires a separate plan.
- Context Usage UI (`getContextUsage`) and Usage Dashboard measure different things — add UI copy in a follow-up if users still conflate them after data fix.
