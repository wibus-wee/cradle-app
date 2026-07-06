import type { UIMessage } from 'ai'

import { isToolLikePart } from '../rendering/chat-tool-entities'
import type { ToolPayload, ToolTodo } from '../rendering/tool-ui-classifier'
import { readPrimaryTodos, readToolInputPayload, readToolPayload } from '../rendering/tool-ui-classifier'

export type ChatTodoStatus = 'todo' | 'processing' | 'completed'

export interface ChatTodoItem {
  id: string | null
  content: string
  status: ChatTodoStatus
  sourceStatus: string | null
}

export interface SessionTodoSnapshot {
  messageId: string
  toolCallId: string
  todos: ChatTodoItem[]
}

export function projectChatTodos(input: ToolPayload, output: ToolPayload): ChatTodoItem[] {
  return readPrimaryTodos(input, output).map(projectChatTodo)
}

export function selectTodosFromMessages(messages: UIMessage[]): SessionTodoSnapshot | null {
  const fallbackSnapshot = selectTodosFromToolPayloads(messages)
  const pluginSnapshot = selectTodosFromPluginState(messages)
  return pluginSnapshot ?? fallbackSnapshot
}

function selectTodosFromPluginState(messages: UIMessage[]): SessionTodoSnapshot | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      if (!isToolLikePart(part)) {
        continue
      }
      const todos = readTodoPluginState(part.output)
      if (todos.length > 0) {
        return {
          messageId: message.id,
          toolCallId: part.toolCallId,
          todos,
        }
      }
    }
  }

  return null
}

function selectTodosFromToolPayloads(messages: UIMessage[]): SessionTodoSnapshot | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      if (!isToolLikePart(part)) {
        continue
      }
      const todos = projectChatTodos(
        readToolInputPayload(part.input, part.argumentsText),
        readToolPayload(part.output),
      )
      if (todos.length > 0) {
        return {
          messageId: message.id,
          toolCallId: part.toolCallId,
          todos,
        }
      }
    }
  }

  return null
}

export function readTodoCompletion(todos: ChatTodoItem[]): { completed: number, total: number } {
  return {
    completed: todos.filter(todo => todo.status === 'completed').length,
    total: todos.length,
  }
}

function projectChatTodo(todo: ToolTodo): ChatTodoItem {
  const status = mapTodoStatus(todo.status)
  return {
    id: todo.id,
    content: readTodoLabel(todo, status),
    status,
    sourceStatus: todo.status,
  }
}

function readTodoPluginState(output: unknown): ChatTodoItem[] {
  if (!isRecord(output)) {
    return []
  }
  const pluginState = isRecord(output.pluginState) ? output.pluginState : null
  return pluginState ? readPluginTodos(pluginState.todos) : []
}

function readPluginTodos(value: unknown): ChatTodoItem[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item) => {
    const record = isRecord(item) ? item : {}
    const content = readString(record.content)
    const status = readPluginTodoStatus(record.status)
    if (!content || !status) {
      return []
    }
    return [{
      id: readString(record.id),
      content,
      status,
      sourceStatus: readString(record.sourceStatus),
    }]
  })
}

function readPluginTodoStatus(value: unknown): ChatTodoStatus | null {
  return value === 'todo' || value === 'processing' || value === 'completed' ? value : null
}

function mapTodoStatus(status: string | null): ChatTodoStatus {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'in_progress':
    case 'processing':
      return 'processing'
    case 'pending':
    case 'todo':
    default:
      return 'todo'
  }
}

function readTodoLabel(todo: ToolTodo, status: ChatTodoStatus): string {
  if (status === 'processing') {
    return todo.activeForm ?? todo.content ?? 'Untitled task'
  }
  return todo.content ?? todo.activeForm ?? 'Untitled task'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
