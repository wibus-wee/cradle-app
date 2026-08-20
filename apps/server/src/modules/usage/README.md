# Usage Module

Provides read-model analytics for `usage_logs` including daily totals, hourly patterns, dashboard summary, streak stats, per-session totals, recent session feed rows, and cost summaries.
Token and cost breakdowns use `sessions.agentId` for Agent attribution and `usage_logs.providerTargetId` for provider-target attribution.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands. `POST /usage/reconcile/claude` is an explicit repair operation for completed Claude Agent bindings: it rereads only Cradle-owned Claude transcripts and upserts deterministic message usage events. It does not run automatically, touch pending scheduler work, or retry blocked bindings.

`usage_logs` is the single Cradle-owned usage fact ledger. Codex writes one deterministic row per native model-call checkpoint through `provider-events` accounting; each row carries the Cradle session, root provider session, actual provider thread/turn, model, delta usage, cumulative provider checkpoint, and event timestamp. Codex rollout reconciliation starts only from durable Cradle Codex bindings and reads only the dedicated Cradle Codex runtime home, so global `~/.codex` sessions and other local provider archives are outside this module's authority. Existing runtimes that have not exposed equivalent per-call events continue to write one `run-summary` row.

Token totals and cost are summed over fact rows. Fields named `count`, `turnCount`, or `totalTurns` represent distinct logical turns, keyed by Cradle run id when available and then provider turn id; they do not count model-call rows. Session usage also returns a `byModel` projection from the same ledger. For a bound Codex thread, that response may include a `providerBillingCheck` read directly from Codex account usage with provider estimates, grouped token totals, and the delta from the ledger. This field is reconciliation evidence only: reading it performs no Usage mutation and never writes the provider-events ledger. Cached input, cache-write input, and reasoning output remain subsets of prompt and completion usage and are never added to `totalTokens` a second time.

Cost summary and daily-cost responses expose uncached input, cache-read, cache-write, and output token/cost components. `pricing.ts` owns this split so every consumer uses the same models.dev cache rates and the same fallback to ordinary input pricing when a model has no dedicated cache price.

`GET /usage/performance` is the runtime-neutral performance read model. It includes only completed run snapshots and calculates P50/P95 time to first model token from the first `model_first_token_delta` event, plus total duration from snapshot start to completion. Tool-only runs can have no first-token event: they remain total-duration samples, while `firstTokenSampleCount` reports the smaller TTFT denominator. Results are grouped by runtime, provider target, model, and date.

Performance coverage follows run-snapshot retention, not the permanent usage ledger. Successful snapshots default to 30 days, so a 90-day or one-year Usage range may have a shorter performance window. The response returns `coverageStartedAt` and `coverageEndedAt`, and the dashboard displays that actual recorded interval.

## Files

- **budget.ts**: Budget threshold helpers for usage cost checks.
- **index.ts**: Elysia routes under `/usage`, including CLI metadata for generated commands.
- **ingest.ts**: Required provider-event identity validation and idempotent Drizzle insertion into `usage_logs`.
- **model.ts**: TypeBox request and response schemas for usage and cost endpoints.
- **performance.ts**: Completed-run latency aggregation and percentile calculation over retained run snapshots.
- **pricing.ts**: Model pricing lookup and authoritative uncached/cache-read/cache-write/output cost calculation.
- **service.ts**: Drizzle queries, agent/provider attribution, cost aggregation, and streak calculations.
