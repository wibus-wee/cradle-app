# Usage Module

Provides read-model analytics for `usage_logs` including daily totals, dashboard summary, streak stats, per-session totals, and cost summaries.
Token and cost breakdowns use `sessions.agentId` for Agent attribution and `usage_logs.providerTargetId` for provider-target attribution.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- **budget.ts**: Budget threshold helpers for usage cost checks.
- **index.ts**: Elysia routes under `/usage`, including CLI metadata for generated commands.
- **model.ts**: TypeBox request and response schemas for usage and cost endpoints.
- **pricing.ts**: Model pricing lookup and cost calculation helpers.
- **service.ts**: Drizzle queries, agent/provider attribution, cost aggregation, and streak calculations.
