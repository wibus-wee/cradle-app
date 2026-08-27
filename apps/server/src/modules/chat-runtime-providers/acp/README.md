# ACP Chat Runtime

This package is Cradle's stdio ACP client runtime. It owns protocol negotiation, the spawned agent connection, native session requests, and projection into the shared Chat Runtime contract. Installed-agent metadata and auth selections remain owned by [`modules/acp`](../../acp/README.md); credential values remain owned by `modules/secrets`.

| Area | Owner | Behavior |
| --- | --- | --- |
| Connection | `connection-manager.ts` | Initializes ACP, validates protocol version, applies request deadlines, and tears down unhealthy processes. |
| Authentication | `auth.ts`, `connection-manager.ts` | Projects advertised methods, performs agent auth, and uses a discovery-first respawn for env-var auth. |
| Process | `process-manager.ts` | Resolves launch commands, captures bounded stderr, and redacts injected auth values. |
| Runtime projection | `provider.ts` | Resolves installed agents, preserves strict resume failures, and exposes auth discovery/reconnect operations. |
| Timeline | `timeline-mapper.ts` | Maps supported ACP session updates into AI SDK message chunks. |
| Integration | `runtime-integration.ts` | Bridges permissions and native titles into Chat Runtime owners. |

## Connection and authentication

Initialization sends the server package version and requires the agent to return the SDK `PROTOCOL_VERSION`. A connection is published only after negotiation and any selected authentication method succeed. Spawn, initialization, version, or authentication failure closes the SDK connection and stops the unpublished child process.

An installed agent stores only an auth method ID and env-name-to-credential-ref bindings. A cold env-var connection first initializes without those credential values, validates the live method contract, stops the discovery process, resolves values through the Secrets owner, and respawns once with the selected variables. Agent-managed auth runs on the discovery connection. Terminal auth is reported as unsupported because Cradle does not advertise ACP terminal capabilities.

All metadata requests have a 30-second deadline, authentication has a five-minute deadline, and prompts have a ten-minute deadline. SDK cancellation is cooperative, so a local timeout also sends best-effort `session/cancel`, closes the connection, fails every channel, and stops the per-agent process.

## Session and turn lifecycle

Session creation, load, resume, prompt, cancellation, and config-option writes use typed ACP SDK methods. Registered stdio MCP servers are included in every session lifecycle request. Resume fallback is limited to exact JSON-RPC method-not-found (`-32601`) and resource-not-found (`-32002`) errors; auth, timeout, process, and protocol errors are preserved.

A native session accepts at most one active prompt. Normal completion flushes mapper state and emits one finish chunk using the ACP stop reason. Provider failures throw without a finish chunk, while user cancellation aborts the request and closes the local stream without a finish chunk so Chat Runtime remains the terminal-state owner.

ACP's model selector is a session config option with `category: "model"`. Draft sessions expose exact advertised model values, and model changes use `session/set_config_option`. Client filesystem writes remain fail-closed until the runtime approval handler allows that individual write.
