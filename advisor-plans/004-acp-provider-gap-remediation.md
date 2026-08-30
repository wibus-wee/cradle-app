# 004 - ACP Runtime Negotiation, Turn Correctness, and Authentication

## Status

This implementation plan is retired.

The runtime-negotiation and turn-correctness work described by the original plan has been implemented and is now owned by the ACP runtime code and its focused tests. The experimental environment-variable authentication flow was removed in #211 after the ACP protocol removed that auth method. #212 removes the persistence that was intentionally left behind for a separate schema cleanup.

Do not use older revisions of this document as an implementation contract for ACP authentication.

## Current authentication model

Cradle persists only the selected ACP authentication method ID on an installed agent.

- Methods without a terminal type are projected as `agent` authentication and are supported.
- Terminal authentication remains visible but unsupported because Cradle does not host an interactive ACP terminal.
- Selecting a method validates that it is currently advertised and supported, persists the method ID, records an audit event, and lets the ACP runtime perform the protocol-native authentication handshake.
- Clearing authentication removes only the selected method ID and records an audit event.
- ACP-owned storage does not persist authentication credential references or credential values.

The source of truth for method projection is [`apps/server/src/modules/chat-runtime-providers/acp/auth.ts`](../apps/server/src/modules/chat-runtime-providers/acp/auth.ts). Selection persistence is owned by [`apps/server/src/modules/acp/service.ts`](../apps/server/src/modules/acp/service.ts).

## Remote transport credentials are separate

`remote_headers_secret_refs_json` remains intentionally supported.

Those references configure HTTP/WebSocket transport headers for remote ACP agents. They point at Secrets-owned credentials and are unrelated to ACP authentication methods. Removing the retired ACP authentication persistence must not remove, reset, or reinterpret remote transport header references.

The remote-agent service validates header names and referenced Secrets records, stores only references, and keeps credential values out of audit details.

## Current API contract

The ACP auth surface supports the protocol-native selection lifecycle:

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/acp/agents/:agentId/auth-methods` | Return currently advertised methods and the selected method ID. |
| `PUT` | `/acp/agents/:agentId/auth` | Validate and persist `{ methodId }`, then reconnect as required by the runtime. |
| `DELETE` | `/acp/agents/:agentId/auth` | Clear the selected method and disconnect the current ACP connection. |

No ACP auth endpoint accepts plaintext credentials or auth-owned secret references.

## Runtime invariants retained from this plan

The following requirements remain active even though the plan itself is retired:

- initialization validates the negotiated ACP protocol version before publishing a connection;
- native requests have bounded local deadlines and unhealthy timed-out connections are torn down;
- one native session cannot have overlapping prompt channels;
- normal completion emits one finish result, while provider failure and user cancellation do not fabricate a successful finish;
- resume/load fallback is limited to explicit missing-method or missing-resource errors rather than swallowing auth, timeout, protocol, or process failures;
- exact ACP auth-required failures are projected through the provider-neutral Chat Runtime error contract;
- authentication occurs before session lifecycle operations when a method is selected.

Implementation and regression coverage live beside the ACP runtime rather than in this historical plan.

## Focused validation

For ACP auth or persistence changes, run the focused checks that exercise the current contract:

```bash
pnpm --filter @cradle/db generate
pnpm vitest run apps/server/tests/acp-auth.test.ts apps/server/src/modules/acp apps/server/src/modules/chat-runtime-providers/acp
pnpm --filter @cradle/server typecheck
pnpm --filter @cradle/server check:boundaries
pnpm exec eslint packages/db/src/schema/acp.ts apps/server/src/modules/acp apps/server/src/modules/chat-runtime-providers/acp
git diff --check
```

Review generated Drizzle SQL and metadata whenever the schema changes. Remote transport header references must remain covered independently from ACP authentication selection.
