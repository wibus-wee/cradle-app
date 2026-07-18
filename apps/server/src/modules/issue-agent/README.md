# Issue Agent Module

Owns issue delegation semantics only: assigning an issue to an agent delegate, clearing delegation, building the issue prompt, and bridging delegated work into Chat Runtime.

Agent session and activity records are owned by `../agent-interaction-runtime`. Issue Agent writes those records only through the Agent Interaction Runtime service. Chat Runtime owns provider execution, `backend_runs`, messages, queue/steer, snapshots, usage, and cancellation.

Route metadata includes `x-cradle-cli` descriptors for generated CLI commands on the existing issue delegation and issue-agent-session command surface.
The continuation bridge records Agent Interaction activity and session status for visibility, but queue state is owned by Chat Runtime in `chat_session_queue_items`. Issue Agent reads Chat Runtime queue/run state to keep delegated Agent Sessions active while queued continuations drain, and stop/undelegate cancels the linked Chat Session run plus pending queue items instead of writing Issue Agent-owned queue state.
Delegated runs read Agent Identity-owned model and thinking-effort preferences, snapshot those preferences into the linked Chat Session, then let Chat Runtime resolve run defaults from the session. Provider execution and durable model binding remain Chat Runtime-owned. A delegation requested with `runInIsolation` is executed as a Work with a managed worktree and a Work primary thread. Reruns derive that execution mode from the previously attached thread so they remain Work runs. Work delivery remains owned by the Work agent lifecycle through `manage_pull_request`; Issue Agent does not synthesize handoff metadata when a chat run finishes.

## Files

- `index.ts`: Elysia routes for issue delegation, issue-linked session projection, and the UI-only continuation bridge.
- `model.ts`: TypeBox schemas for delegation state, issue-specific session views, continuation requests, params, and bodies. Generic activity/status schemas are imported from Agent Interaction Runtime.
- `service.ts`: delegation semantics, unified issue assignee synchronization, agent identity resolution, issue prompts with stable issue IDs, chat-runtime completion subscription for delegated run status, continuation watcher status projection, and stop/undelegate cancellation of linked Chat Runtime work.
