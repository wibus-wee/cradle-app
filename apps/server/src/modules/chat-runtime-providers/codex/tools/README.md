# Codex Tools

Codex provider-owned tool semantics.

This directory maps Codex app-server tool items and server-initiated requests into Cradle's shared tool envelope. The parent `codex/turn/event-to-chunk-mapper.ts` owns notification sequencing; this directory owns Codex tool identity and payload semantics.

## Files

- `identity.ts`: Codex tool identifier.
- `mapper.ts`: Codex app-server item and server-request input/result envelope constructors.
