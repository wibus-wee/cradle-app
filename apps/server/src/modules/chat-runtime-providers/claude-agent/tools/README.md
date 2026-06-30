# Claude Agent Tools

Claude Agent provider-owned tool semantics.

This directory maps Claude Agent SDK `tool_use` / `tool_result` data into Cradle's shared tool envelope. The parent `claude-agent/event-to-chunk-mapper.ts` owns SDK message sequencing; this directory owns Claude Code tool identity and payload semantics.

## Files

- `identity.ts`: Claude Code tool identifier and canonical API names.
- `mapper.ts`: Claude Code tool input/result envelope constructors.
- `task-progress-state.ts`: Structured TaskCreate/TaskUpdate/TaskList projection into Cradle's provider progress state without parsing display strings.
- `todo-plugin-state.ts`: TodoWrite input projection into Cradle's persisted todo plugin state.
