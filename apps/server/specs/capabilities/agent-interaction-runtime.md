# Capability: Agent Interaction Runtime

## User / System Goal

- Cradle has a single server owner for agent session lifecycle and append-only agent activity records.
- Issue delegation can show agent work without making Issue Agent own generic interaction state.
- Future interaction sources such as comment mentions, manual agent sessions, automations, and MCP clients can reuse the same session/activity protocol without creating a global task runtime.

## Current Behavior Evidence

- `packages/db/src/schema/agent-interaction.ts` owns the `agent_sessions` and `agent_activities` tables.
- `apps/server/src/modules/agent-interaction-runtime/service.ts` owns session create/read/status writes and activity append/list.
- `apps/server/src/modules/issue-agent/service.ts` calls Agent Interaction Runtime for session/activity writes and no longer imports `agentSessions` or `agentActivities` directly.
- Chat Runtime still owns provider execution through `backend_runs`, `messages`, `chat_session_queue_items`, snapshots, usage, and cancellation.

## Target API Slice

- `GET /agent-sessions/:agentSessionId`
- `GET /agent-sessions/:agentSessionId/activities`

The current issue delegation UI still uses existing issue routes and issue-agent-session routes. The new generic HTTP namespace is intentionally exposed first without generated CLI metadata; CLI command migration should happen when frontend/generated clients are migrated to the generic route names.

## Target Module Design

- `AgentInteractionRuntimeModule`
  - `index.ts`: HTTP route projection for generic agent sessions and activities.
  - `model.ts`: TypeBox session/activity schemas.
  - `service.ts`: DB-backed session lifecycle and activity append-only helpers.
- The module owns session/activity records and status projection.
- The module reads no issue semantics beyond the stored issue ID.
- The module does not own issue mutation, provider execution, queue/steer rows, run snapshots, usage, or provider-native plans/tools.

## Test Plan

- OpenAPI exposes `/agent-sessions/{agentSessionId}/activities`.
- Delegating an issue still creates activities through Issue Agent, and those activities are readable from the generic `/agent-sessions/:id/activities` route.
- Missing generic session routes return `agent_interaction_session_not_found`.
