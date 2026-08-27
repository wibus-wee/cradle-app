# ACP Runtime Limits

This file records ACP behavior that the Cradle Chat Runtime deliberately does not advertise or cannot yet verify. Implemented behavior is documented in [`README.md`](./README.md), not repeated here.

| Surface | Status | Reason and user effect |
| --- | --- | --- |
| Last-turn rollback | Unsupported | ACP 1.2.1 has no rollback method. Chat Runtime does not advertise rollback for ACP sessions. |
| Arbitrary runtime settings | Unsupported | Native config options have provider-specific semantics. Model and mode changes have typed projections; other options are not normalized into the shared runtime-settings contract. |
| Live steering | Queue fallback | ACP has cancellation but no native steer request. Guidance submitted during a turn is queued by the Chat Runtime owner. |
| Remote HTTP/WebSocket agents | Not configured | The SDK transports exist, but installed-agent configuration owns local executable launch records and cannot represent a remote endpoint or its credential policy. Adding this requires a `modules/acp` configuration contract and UI, not a transport-only branch in this provider. |
| Inline authentication recovery | Not projected | Auth methods and Secrets-backed configuration are available in Runtimes settings. The shared Chat Runtime has no typed action that can configure a provider and resume the exact failed turn, so ACP auth failures terminate the run instead of exposing a provider-specific action URL. |
| Disconnected native deletion | Best effort | Native delete/close requires an owning live agent connection. Cradle removes its durable session normally, but cannot prove cleanup inside a process that has already exited. |
| Real-agent interoperability | Unverified in this repository | Focused protocol tests cover negotiation, rich content, MCP, lifecycle, interactions, tools, and failures with an in-memory ACP peer. A named auth-required binary and an opt-in real-turn smoke fixture are still required before declaring external-agent compatibility. |

## Adjacent ownership

Two concerns remain outside this runtime module:

- Legacy launch `env` and `overrideEnv` values in `modules/acp` are stored in the installed-agent row. Authentication fields already use Secrets-owned references, but migrating arbitrary launch environment values requires a dedicated `modules/acp` data contract and migration.
- HTTP/WebSocket ACP endpoints likewise require installed-agent configuration, credential ownership, validation, and settings UI in `modules/acp`. This runtime must not overload executable fields to infer a remote transport.

These limits are explicit so metadata and UI surfaces do not imply behavior the owning contracts cannot support.
