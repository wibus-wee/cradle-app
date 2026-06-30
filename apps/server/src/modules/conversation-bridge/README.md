# Conversation Bridge

This module owns Cradle's server-side bridge from external conversation platforms into Cradle chat sessions.

- `index.ts`: HTTP management routes for registered adapters, bridge connections, channel bindings, recent thread bindings, explicit runtime start/stop, and failed delivery retries.
- `model.ts`: Elysia response and request schemas for the conversation bridge API.
- `runtime-supervisor.ts`: Starts and stops plugin-provided adapter runtimes for enabled connections, resolves secret refs through the `secrets` module, exposes the host callbacks used by adapters, and delivers assistant responses through the running adapter.
- `service.ts`: Cradle-owned persistence and semantics for connection CRUD, channel bindings, thread bindings, inbound event idempotency, session creation, chat-runtime forwarding, delivery attempt recording, retry, and health projection.

Adapters are plugin-owned protocol drivers. They may connect to Slack, Discord, or another platform, normalize inbound messages, and post outbound messages. They do not write conversation bridge tables and they do not create Cradle sessions directly. The bridge core stores platform-specific values only in generic `external_*` identifiers and JSON payload fields. Platform credentials are stored as secret refs and are resolved to plaintext only in memory when `runtime-supervisor.ts` starts an adapter runtime.

Routes intentionally do not expose `x-cradle-cli` metadata yet. The API is management-oriented and includes connection start/stop operations that may require live platform credentials; CLI exposure should be added only after the route surface stabilizes for Agent-facing shell use.
