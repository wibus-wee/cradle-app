# Pty Module

Provides session-owned chat PTYs plus panel-owned shell PTYs. CLI TUI sessions can report durable providerSession bindings for resume after process death/server restart. HTTP owns resource lifecycle (`start-or-attach`, `delete`), host diagnostics (`host`), provider bindings (`provider-session`), and terminal resource snapshots (`resources`). WebSocket owns the live channel protocol (`snapshot` / `output` / `exit` and `input` / `resize` / `ping`). Snapshot events carry restore metadata (`live-attach` / `resume` / `fresh` / `history`). Natural process exits release runtime registry records immediately while retaining the bounded timeline exit/snapshot history; explicit deletes and session archive/delete lifecycle events stop matching chat PTYs. Closing a chat surface only releases the renderer view, so a live CLI TUI PTY remains available for a later live attach.

Opt-in durable screen history lives under `$CRADLE_DATA_DIR/terminal-history` when `CRADLE_TERMINAL_HISTORY=1`. Native agent resume still wins over history replay.

## Files

- `index.ts`: Elysia HTTP + WebSocket route surface under `/terminal-sessions/*`.
- `model.ts`: TypeBox schemas for control routes and live-channel payloads.
- `protocol.ts`: Shared PTY WebSocket protocol types, including optional snapshot restore metadata.
- `history.ts`: Opt-in durable terminal history under `$CRADLE_DATA_DIR/terminal-history` (`CRADLE_TERMINAL_HISTORY=1`). Seeds timeline buffers on cold fresh launches; native resume still wins.
- `codex-session-capture.ts`: Conservative Codex CLI JSONL metadata reader for cli-tui session resume bindings and `session_index.jsonl` titles.
- `kimi-session-capture.ts`: Kimi Code session index/state reader for cli-tui session resume bindings and provider titles.
- `pty.runtime.ts`: `node-pty` runtime registry, process lifecycle hooks, and process tree memory/CPU resource sampling.
- `pty.timeline.ts`: Sequence-aware snapshots, replay windows, exit history, and restore metadata.
- `pty.socket.ts`: WebSocket adapter that bridges runtime/timeline to clients.
- `launch-planner.ts`: Pure CLI TUI launch planner. Decides `live-attach` / `resume` / `fresh`, builds Claude/Codex/Kimi argv, resolves generalized `providerSession` bindings (with legacy `codexCliSession` compat), and decides when provider filesystem capture is needed.
- `service.ts`: Session/profile/workspace ownership rules, start-or-attach orchestration, host diagnostics, session archive/delete PTY release hooks, memory/CPU resource totals, explicit bottom-panel shell lifecycle, and module shutdown. `startOrAttach` returns `{ sessionId, running, mode, restore }`.
# PTY lifecycle and activity

CLI TUI PTYs are server-owned resources. Detaching a WebSocket or closing a
surface only releases the renderer; it does not stop the CLI. A CLI PTY is
destroyed only by an explicit terminal stop, session archive/delete, or server
shutdown. Reopening the session attaches to the existing PTY when it is still
running.

The live channel also carries an optional `status` event. Cradle parses the
provider side-channel used by Orca/Herdr (`OSC 9999` JSON payloads) into
`unknown`, `idle`, `working`, or `blocked` without forwarding the private
sequence to the terminal. Without a provider hook or status side-channel, the
state remains `unknown`; PTY byte activity and CPU usage are intentionally not
treated as proof of model streaming.
