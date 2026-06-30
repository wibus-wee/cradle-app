import type { BuiltinToolCallInputPayload, BuiltinToolCallResultPayload } from '../../tools/tool-call-payload'
import {
  createBuiltinToolCallInputPayload,
  createBuiltinToolCallResultPayload,
} from '../../tools/tool-call-payload'
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

export function createClaudeCodeToolInputPayload(apiName: string, args: unknown): BuiltinToolCallInputPayload {
  return createBuiltinToolCallInputPayload({
    identifier: ClaudeCodeToolIdentifier,
    apiName: normalizeClaudeCodeToolApiName(apiName),
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
    args: input.args,
    result: input.result,
  })
}
