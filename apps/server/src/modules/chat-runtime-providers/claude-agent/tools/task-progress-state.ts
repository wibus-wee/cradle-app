import type { TaskCreateInput, TaskCreateOutput, TaskListOutput, TaskUpdateInput, TaskUpdateOutput } from '@anthropic-ai/claude-agent-sdk/sdk-tools'

import { ClaudeCodeToolName } from './identity'
import type { TodoPluginItem, TodoPluginStatus } from './todo-plugin-state'

type ClaudeAgentTaskStatus = 'pending' | 'in_progress' | 'completed'

interface ClaudeAgentTaskItem {
  id: string
  subject: string
  description: string | null
  activeForm: string | null
  status: ClaudeAgentTaskStatus
}

export interface ClaudeAgentTaskProgressState {
  tasksById: Map<string, ClaudeAgentTaskItem>
  pendingCreatesByToolCallId: Map<string, TaskCreateInput>
  pendingUpdatesByToolCallId: Map<string, TaskUpdateInput>
}

export function createClaudeAgentTaskProgressState(): ClaudeAgentTaskProgressState {
  return {
    tasksById: new Map(),
    pendingCreatesByToolCallId: new Map(),
    pendingUpdatesByToolCallId: new Map(),
  }
}

export function captureClaudeAgentTaskToolInput(
  toolCallId: string,
  toolName: string,
  input: unknown,
  state: ClaudeAgentTaskProgressState,
): void {
  switch (normalizeTaskToolName(toolName)) {
    case ClaudeCodeToolName.TaskCreate: {
      const taskInput = readTaskCreateInput(input)
      if (taskInput) {
        state.pendingCreatesByToolCallId.set(toolCallId, taskInput)
      }
      return
    }
    case ClaudeCodeToolName.TaskUpdate: {
      const taskInput = readTaskUpdateInput(input)
      if (taskInput) {
        state.pendingUpdatesByToolCallId.set(toolCallId, taskInput)
      }
    }
    default:
  }
}

export function captureClaudeAgentTaskToolResult(
  toolCallId: string,
  toolName: string,
  output: unknown,
  state: ClaudeAgentTaskProgressState,
): TodoPluginItem[] | null {
  switch (normalizeTaskToolName(toolName)) {
    case ClaudeCodeToolName.TaskCreate:
      return applyTaskCreateResult(toolCallId, output, state)
    case ClaudeCodeToolName.TaskUpdate:
      return applyTaskUpdateResult(toolCallId, output, state)
    case ClaudeCodeToolName.TaskList:
      return applyTaskListResult(output, state)
    default:
      return null
  }
}

function applyTaskCreateResult(
  toolCallId: string,
  output: unknown,
  state: ClaudeAgentTaskProgressState,
): TodoPluginItem[] | null {
  const result = readTaskCreateOutput(output)
  if (!result) {
    return null
  }
  const input = state.pendingCreatesByToolCallId.get(toolCallId) ?? null
  state.pendingCreatesByToolCallId.delete(toolCallId)
  const id = result.task.id
  const subject = input?.subject ?? result.task.subject
  state.tasksById.set(id, {
    id,
    subject,
    description: input?.description ?? null,
    activeForm: input?.activeForm ?? null,
    status: 'pending',
  })
  return readTaskTodos(state)
}

function applyTaskUpdateResult(
  toolCallId: string,
  output: unknown,
  state: ClaudeAgentTaskProgressState,
): TodoPluginItem[] | null {
  const result = readTaskUpdateOutput(output)
  if (!result?.success) {
    return null
  }
  const input = state.pendingUpdatesByToolCallId.get(toolCallId) ?? null
  state.pendingUpdatesByToolCallId.delete(toolCallId)
  if (input?.status === 'deleted') {
    state.tasksById.delete(result.taskId)
    return readTaskTodos(state)
  }

  const existing = state.tasksById.get(result.taskId)
  const subject = input?.subject ?? existing?.subject
  if (!subject) {
    return null
  }

  const status = readTaskStatus(input?.status)
    ?? readTaskStatus(result.statusChange?.to)
    ?? existing?.status
    ?? 'pending'
  state.tasksById.set(result.taskId, {
    id: result.taskId,
    subject,
    description: input?.description ?? existing?.description ?? null,
    activeForm: input?.activeForm ?? existing?.activeForm ?? null,
    status,
  })
  return readTaskTodos(state)
}

function applyTaskListResult(output: unknown, state: ClaudeAgentTaskProgressState): TodoPluginItem[] | null {
  const result = readTaskListOutput(output)
  if (!result) {
    return null
  }
  state.tasksById.clear()
  for (const task of result.tasks) {
    state.tasksById.set(task.id, {
      id: task.id,
      subject: task.subject,
      description: null,
      activeForm: null,
      status: task.status,
    })
  }
  return readTaskTodos(state)
}

function readTaskTodos(state: ClaudeAgentTaskProgressState): TodoPluginItem[] | null {
  const todos = Array.from(state.tasksById.values()).map(projectTaskTodo)
  return todos.length > 0 ? todos : null
}

function projectTaskTodo(task: ClaudeAgentTaskItem): TodoPluginItem {
  const status = mapTaskStatus(task.status)
  return {
    id: task.id,
    content: status === 'processing'
      ? task.activeForm ?? task.subject
      : task.subject,
    status,
    sourceStatus: task.status,
  }
}

function mapTaskStatus(status: ClaudeAgentTaskStatus): TodoPluginStatus {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'in_progress':
      return 'processing'
    case 'pending':
    default:
      return 'todo'
  }
}

function normalizeTaskToolName(toolName: string): ClaudeCodeToolName | null {
  switch (toolName.toLowerCase()) {
    case 'taskcreate':
    case 'task_create':
      return ClaudeCodeToolName.TaskCreate
    case 'taskupdate':
    case 'task_update':
      return ClaudeCodeToolName.TaskUpdate
    case 'tasklist':
    case 'task_list':
      return ClaudeCodeToolName.TaskList
    default:
      return null
  }
}

function readTaskCreateInput(value: unknown): TaskCreateInput | null {
  const record = readRecord(value)
  const subject = readTrimmedString(record.subject)
  const description = readTrimmedString(record.description)
  if (!subject || !description) {
    return null
  }
  const activeForm = readTrimmedString(record.activeForm)
  const metadata = readRecordOrNull(record.metadata)
  return {
    subject,
    description,
    ...(activeForm ? { activeForm } : {}),
    ...(metadata ? { metadata } : {}),
  }
}

function readTaskUpdateInput(value: unknown): TaskUpdateInput | null {
  const record = readRecord(value)
  const taskId = readTrimmedString(record.taskId) ?? readTrimmedString(record.task_id)
  if (!taskId) {
    return null
  }
  const subject = readTrimmedString(record.subject)
  const description = readTrimmedString(record.description)
  const activeForm = readTrimmedString(record.activeForm)
  const status = readTaskUpdateStatus(record.status)
  const metadata = readRecordOrNull(record.metadata)
  return {
    taskId,
    ...(subject ? { subject } : {}),
    ...(description ? { description } : {}),
    ...(activeForm ? { activeForm } : {}),
    ...(status ? { status } : {}),
    ...(metadata ? { metadata } : {}),
  }
}

function readTaskCreateOutput(value: unknown): TaskCreateOutput | null {
  const record = readRecord(value)
  const task = readRecord(record.task)
  const id = readTrimmedString(task.id)
  const subject = readTrimmedString(task.subject)
  return id && subject ? { task: { id, subject } } : null
}

function readTaskUpdateOutput(value: unknown): TaskUpdateOutput | null {
  const record = readRecord(value)
  const success = typeof record.success === 'boolean' ? record.success : null
  const taskId = readTrimmedString(record.taskId) ?? readTrimmedString(record.task_id)
  if (success === null || !taskId) {
    return null
  }
  const updatedFields = Array.isArray(record.updatedFields)
    ? record.updatedFields.filter((field): field is string => typeof field === 'string')
    : []
  const statusChangeRecord = readRecordOrNull(record.statusChange)
  const from = readTrimmedString(statusChangeRecord?.from)
  const to = readTrimmedString(statusChangeRecord?.to)
  return {
    success,
    taskId,
    updatedFields,
    ...(readTrimmedString(record.error) ? { error: readTrimmedString(record.error)! } : {}),
    ...(from && to ? { statusChange: { from, to } } : {}),
  }
}

function readTaskListOutput(value: unknown): TaskListOutput | null {
  const record = readRecord(value)
  if (!Array.isArray(record.tasks)) {
    return null
  }
  const tasks = record.tasks.flatMap((item): TaskListOutput['tasks'] => {
    const task = readRecord(item)
    const id = readTrimmedString(task.id)
    const subject = readTrimmedString(task.subject)
    const status = readTaskStatus(task.status)
    if (!id || !subject || !status) {
      return []
    }
    return [{
      id,
      subject,
      status,
      blockedBy: Array.isArray(task.blockedBy)
        ? task.blockedBy.filter((blockedBy): blockedBy is string => typeof blockedBy === 'string')
        : [],
      ...(readTrimmedString(task.owner) ? { owner: readTrimmedString(task.owner)! } : {}),
    }]
  })
  return tasks.length > 0 ? { tasks } : null
}

function readTaskUpdateStatus(value: unknown): TaskUpdateInput['status'] | null {
  return value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'deleted'
    ? value
    : null
}

function readTaskStatus(value: unknown): ClaudeAgentTaskStatus | null {
  return value === 'pending' || value === 'in_progress' || value === 'completed' ? value : null
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readRecordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
