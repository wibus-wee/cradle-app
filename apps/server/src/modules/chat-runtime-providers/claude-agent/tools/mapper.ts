import type { CradleToolKind } from '../../../chat-runtime/runtime-provider-types'
import { isCradleWriteArtifactToolName } from '../../tools/artifact-tool'
import type { BuiltinToolCallInputPayload, BuiltinToolCallResultPayload } from '../../tools/tool-call-payload'
import {
  createBuiltinToolCallInputPayload,
  createBuiltinToolCallResultPayload,
} from '../../tools/tool-call-payload'
import {
  CLAUDE_PLAN_IMPLEMENTATION_TOOL_NAME,
  isClaudeAgentEnterPlanModeToolName,
  isClaudeAgentExitPlanModeToolName,
} from '../plan-mode'
import { ClaudeCodeToolIdentifier, ClaudeCodeToolName } from './identity'

const CLAUDE_CODE_TOOL_NAME_ALIASES: Record<string, string> = {
  agent: ClaudeCodeToolName.Agent,
  ask_user_question: ClaudeCodeToolName.AskUserQuestion,
  askUserQuestion: ClaudeCodeToolName.AskUserQuestion,
  bash: ClaudeCodeToolName.Bash,
  edit: ClaudeCodeToolName.Edit,
  glob: ClaudeCodeToolName.Glob,
  grep: ClaudeCodeToolName.Grep,
  monitor: ClaudeCodeToolName.Monitor,
  read: ClaudeCodeToolName.Read,
  read_file: ClaudeCodeToolName.Read,
  schedule_wakeup: ClaudeCodeToolName.ScheduleWakeup,
  scheduleWakeup: ClaudeCodeToolName.ScheduleWakeup,
  skill: ClaudeCodeToolName.Skill,
  task_create: ClaudeCodeToolName.TaskCreate,
  taskCreate: ClaudeCodeToolName.TaskCreate,
  task_get: ClaudeCodeToolName.TaskGet,
  taskGet: ClaudeCodeToolName.TaskGet,
  task_list: ClaudeCodeToolName.TaskList,
  taskList: ClaudeCodeToolName.TaskList,
  task_output: ClaudeCodeToolName.TaskOutput,
  taskOutput: ClaudeCodeToolName.TaskOutput,
  task_stop: ClaudeCodeToolName.TaskStop,
  taskStop: ClaudeCodeToolName.TaskStop,
  task_update: ClaudeCodeToolName.TaskUpdate,
  taskUpdate: ClaudeCodeToolName.TaskUpdate,
  todo_write: ClaudeCodeToolName.TodoWrite,
  todoWrite: ClaudeCodeToolName.TodoWrite,
  tool_search: ClaudeCodeToolName.ToolSearch,
  toolSearch: ClaudeCodeToolName.ToolSearch,
  web_fetch: ClaudeCodeToolName.WebFetch,
  webFetch: ClaudeCodeToolName.WebFetch,
  web_search: ClaudeCodeToolName.WebSearch,
  webSearch: ClaudeCodeToolName.WebSearch,
  workflow: ClaudeCodeToolName.Workflow,
  write: ClaudeCodeToolName.Write,
  write_file: ClaudeCodeToolName.Write,
}

export function normalizeClaudeCodeToolApiName(apiName: string): string {
  return CLAUDE_CODE_TOOL_NAME_ALIASES[apiName] ?? apiName
}

const CLAUDE_CODE_TOOL_KINDS: Record<string, CradleToolKind> = {
  [ClaudeCodeToolName.Agent]: 'subagent',
  [ClaudeCodeToolName.AskUserQuestion]: 'question',
  [ClaudeCodeToolName.Bash]: 'terminal',
  [ClaudeCodeToolName.Edit]: 'file-diff',
  [ClaudeCodeToolName.Glob]: 'search',
  [ClaudeCodeToolName.Grep]: 'search',
  [ClaudeCodeToolName.Monitor]: 'terminal',
  [ClaudeCodeToolName.Read]: 'file-read',
  [ClaudeCodeToolName.ScheduleWakeup]: 'generic',
  [ClaudeCodeToolName.Skill]: 'generic',
  [ClaudeCodeToolName.TaskCreate]: 'todo',
  [ClaudeCodeToolName.TaskGet]: 'task-control',
  [ClaudeCodeToolName.TaskList]: 'todo',
  [ClaudeCodeToolName.TaskOutput]: 'task-control',
  [ClaudeCodeToolName.TaskStop]: 'task-control',
  [ClaudeCodeToolName.TaskUpdate]: 'todo',
  [ClaudeCodeToolName.TodoWrite]: 'todo',
  [ClaudeCodeToolName.ToolSearch]: 'search',
  [ClaudeCodeToolName.WebFetch]: 'web',
  [ClaudeCodeToolName.WebSearch]: 'web',
  [ClaudeCodeToolName.Workflow]: 'subagent',
  [ClaudeCodeToolName.Write]: 'file-diff',
}

/**
 * The Claude Agent SDK names every MCP tool call `mcp__<server>__<tool>` — this is the SDK's
 * own stable naming convention (also relied on by the frontend's `formatToolName`), not a guess.
 */
const CLAUDE_AGENT_MCP_TOOL_NAME_PATTERN = /^mcp__/

/**
 * Classifies a Claude Agent tool call into Cradle's canonical vocabulary. Plan-mode and
 * plan-implementation tools are handled ahead of the alias table because they are not part
 * of the SDK's `tool_use.name` enum — they are synthesized locally from other signals.
 */
export function classifyClaudeCodeToolKind(apiName: string): CradleToolKind {
  if (isClaudeAgentEnterPlanModeToolName(apiName) || isClaudeAgentExitPlanModeToolName(apiName)) {
    return 'plan'
  }
  if (apiName === CLAUDE_PLAN_IMPLEMENTATION_TOOL_NAME) {
    return 'plan-implementation'
  }
  if (isCradleWriteArtifactToolName(apiName)) {
    return 'artifact'
  }
  if (CLAUDE_AGENT_MCP_TOOL_NAME_PATTERN.test(apiName)) {
    return 'mcp'
  }
  return CLAUDE_CODE_TOOL_KINDS[normalizeClaudeCodeToolApiName(apiName)] ?? 'generic'
}

export function createClaudeCodeToolInputPayload(apiName: string, args: unknown): BuiltinToolCallInputPayload {
  return createBuiltinToolCallInputPayload({
    identifier: ClaudeCodeToolIdentifier,
    apiName: normalizeClaudeCodeToolApiName(apiName),
    kind: classifyClaudeCodeToolKind(apiName),
    args,
  })
}

export function createClaudeCodeToolResultPayload(input: {
  apiName: string
  args?: unknown
  result: unknown
}): BuiltinToolCallResultPayload {
  return createBuiltinToolCallResultPayload({
    identifier: ClaudeCodeToolIdentifier,
    apiName: normalizeClaudeCodeToolApiName(input.apiName),
    kind: classifyClaudeCodeToolKind(input.apiName),
    args: input.args,
    result: input.result,
  })
}
