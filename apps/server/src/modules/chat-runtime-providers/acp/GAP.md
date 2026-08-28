# ACP Runtime Limits

This file records ACP behavior that the Cradle Chat Runtime deliberately does not advertise or cannot yet verify. Implemented behavior is documented in [`README.md`](./README.md), not repeated here.

| Surface | Status | Reason and user effect |
| --- | --- | --- |
| Last-turn rollback | Unsupported | ACP 1.2.1 has no rollback method. Chat Runtime does not advertise rollback for ACP sessions. |
| Arbitrary runtime settings | Unsupported | Native config options have provider-specific semantics. Model and mode changes have typed projections; other options are not normalized into the shared runtime-settings contract. |
| Live steering | Queue fallback | ACP has cancellation but no native steer request. Guidance submitted during a turn is queued by the Chat Runtime owner. |
| Disconnected native deletion | Best effort | Native delete/close requires an owning live agent connection. Cradle removes its durable session normally, but cannot prove cleanup inside a process that has already exited. |
| Real-agent interoperability | Unverified in this repository | Focused protocol tests cover negotiation, rich content, MCP, lifecycle, interactions, tools, and failures with an in-memory ACP peer. A named auth-required binary and an opt-in real-turn smoke fixture are still required before declaring external-agent compatibility. |

## Adjacent ownership

Two concerns remain outside this runtime module:

- Legacy launch `env` and `overrideEnv` values in `modules/acp` are stored in the installed-agent row. Authentication fields already use Secrets-owned references, but migrating arbitrary launch environment values requires a dedicated `modules/acp` data contract and migration.

These limits are explicit so metadata and UI surfaces do not imply behavior the owning contracts cannot support.
