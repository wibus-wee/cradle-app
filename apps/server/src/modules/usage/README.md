# Usage Module

Provides read-model analytics for `usage_logs` including daily totals, hourly patterns, dashboard summary, streak stats, per-session totals, recent session feed rows, and cost summaries.
Token and cost breakdowns use `sessions.agentId` for Agent attribution and `usage_logs.providerTargetId` for provider-target attribution.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands. `POST /usage/reconcile/claude` is an explicit repair operation for completed Claude Agent bindings: it rereads only Cradle-owned Claude transcripts and upserts deterministic message usage events. It does not run automatically, touch pending scheduler work, or retry blocked bindings.

`usage_logs` is the single Cradle-owned usage fact ledger. Codex writes one deterministic row per native model-call checkpoint through `provider-events` accounting; each row carries the Cradle session, root provider session, actual provider thread/turn, model, delta usage, cumulative provider checkpoint, and event timestamp. Codex rollout reconciliation starts only from durable Cradle Codex bindings and reads only the dedicated Cradle Codex runtime home, so global `~/.codex` sessions and other local provider archives are outside this module's authority. Existing runtimes that have not exposed equivalent per-call events continue to write one `run-summary` row.

Token totals and cost are summed over fact rows. Fields named `count`, `turnCount`, or `totalTurns` represent distinct logical turns, keyed by Cradle run id when available and then provider turn id; they do not count model-call rows. Session usage also returns a `byModel` projection from the same ledger. Cached input and reasoning output remain subsets of prompt and completion usage and are never added to `totalTokens` a second time.

## Files

- **budget.ts**: Budget threshold helpers for usage cost checks.
- **index.ts**: Elysia routes under `/usage`, including CLI metadata for generated commands.
- **ingest.ts**: Required provider-event identity validation and idempotent Drizzle insertion into `usage_logs`.
- **model.ts**: TypeBox request and response schemas for usage and cost endpoints.
- **pricing.ts**: Model pricing lookup and cost calculation helpers.
- **service.ts**: Drizzle queries, agent/provider attribution, cost aggregation, and streak calculations.
