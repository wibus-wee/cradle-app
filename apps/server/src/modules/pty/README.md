# Pty Module

Provides session-owned chat PTYs plus panel-owned shell PTYs. CLI TUI sessions can report durable providerSession bindings for resume after process death/server restart. HTTP owns resource lifecycle (`start-or-attach`, `delete`), host diagnostics (`host`), provider bindings (`provider-session`), and terminal resource snapshots (`resources`). WebSocket owns the live channel protocol (`snapshot` / `output` / `exit` and `input` / `resize` / `ping`). Snapshot events carry restore metadata (`live-attach` / `resume` / `fresh` / `history`). Natural process exits release runtime registry records immediately while retaining the bounded timeline exit/snapshot history; explicit deletes also release the timeline. Session archive lifecycle events stop matching chat PTYs so hidden sessions do not keep CLI TUI processes running.

Opt-in durable screen history lives under `$CRADLE_DATA_DIR/terminal-history` when `CRADLE_TERMINAL_HISTORY=1`. Native agent resume still wins over history replay.

## Files

- `index.ts`: Elysia HTTP + WebSocket route surface under `/terminal-sessions/*`.
- `model.ts`: TypeBox schemas for control routes and live-channel payloads.
- `protocol.ts`: Shared PTY WebSocket protocol types, including optional snapshot restore metadata.
- `history.ts`: Opt-in durable terminal history under `$CRADLE_DATA_DIR/terminal-history` (`CRADLE_TERMINAL_HISTORY=1`). Seeds timeline buffers on cold fresh launches; native resume still wins.
- `codex-session-capture.ts`: Conservative Codex CLI JSONL metadata reader for cli-tui session resume bindings.
- `pty.runtime.ts`: `node-pty` runtime registry, process lifecycle hooks, and process tree memory/CPU resource sampling.
- `pty.timeline.ts`: Sequence-aware snapshots, replay windows, exit history, and restore metadata.
- `pty.socket.ts`: WebSocket adapter that bridges runtime/timeline to clients.
- `launch-planner.ts`: Pure CLI TUI launch planner. Decides `live-attach` / `resume` / `fresh`, builds Claude/Codex argv, resolves generalized `providerSession` bindings (with legacy `codexCliSession` compat), and decides when Codex filesystem capture is needed.
- `service.ts`: Session/profile/workspace ownership rules, start-or-attach orchestration, host diagnostics, session archive/delete PTY release hooks, memory/CPU resource totals, explicit bottom-panel shell lifecycle, and module shutdown. `startOrAttach` returns `{ sessionId, running, mode, restore }`.
