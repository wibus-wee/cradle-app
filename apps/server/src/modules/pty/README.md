# Pty Module

Provides session-owned chat PTYs plus panel-owned shell PTYs. HTTP owns resource lifecycle (`start-or-attach`, `delete`), terminal resource snapshots (`resources`), and WebSocket owns the live channel protocol (`snapshot` / `output` / `exit` and `input` / `resize` / `ping`). Natural process exits release runtime registry records immediately while retaining the bounded timeline exit/snapshot history; explicit deletes also release the timeline. Session archive lifecycle events stop matching chat PTYs so hidden sessions do not keep CLI TUI processes running.

## Files

- `index.ts`: Elysia HTTP + WebSocket route surface under `/terminal-sessions/*`.
- `model.ts`: TypeBox schemas for control routes and live-channel payloads.
- `protocol.ts`: Shared PTY WebSocket protocol types.
- `codex-session-capture.ts`: Conservative Codex CLI JSONL metadata reader for cli-tui session resume bindings.
- `pty.runtime.ts`: `node-pty` runtime registry, process lifecycle hooks, and process tree memory/CPU resource sampling.
- `pty.timeline.ts`: Sequence-aware snapshots, replay windows, and exit history.
- `pty.socket.ts`: WebSocket adapter that bridges runtime/timeline to clients.
- `service.ts`: Session/profile/workspace ownership rules, session archive/delete PTY release hooks, memory/CPU resource totals, explicit bottom-panel shell lifecycle, and module shutdown.
