# Agent Interaction Runtime Module

Owns Cradle's generic agent interaction protocol: agent session records, append-only agent activity records, and session lifecycle status projection.

This module does not own issue fields, issue delegation policy, Chat Runtime execution, provider adapters, queue rows, or provider-native run snapshots. Issue Agent reads and writes through this module when an issue is delegated. Chat Runtime remains the execution owner for provider runs, messages, queue/steer, snapshots, usage, and cancellation.

The physical SQLite tables are `agent_sessions` and `agent_activities`, declared in `packages/db/src/schema/agent-interaction.ts`.

## Files

- `index.ts`: Elysia routes for generic agent session/activity reads.
- `model.ts`: TypeBox schemas for agent sessions, activities, and route params.
- `service.ts`: DB-backed session/activity lifecycle helpers used by Issue Agent and future interaction sources.
