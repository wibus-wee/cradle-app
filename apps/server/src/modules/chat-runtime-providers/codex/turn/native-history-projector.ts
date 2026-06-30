import type { ContentItem as CodexContentItem } from '../app-server-protocol/ContentItem'
import type { ResponseItem as CodexResponseItem } from '../app-server-protocol/ResponseItem'
import type { ThreadItem } from '../app-server-protocol/v2/ThreadItem'
import type { Turn } from '../app-server-protocol/v2/Turn'
import type { UserInput } from '../app-server-protocol/v2/UserInput'
import type { CodexAppServerItem } from '../tools/mapper'
import {
  buildCodexToolArgs,
  buildCodexToolResult,
  readCodexToolName,
} from '../tools/mapper'

const TOOL_LIKE_ITEM_TYPES = new Set([
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'collabAgentToolCall',
  'subAgentActivity',
  'webSearch',
  'sleep',
  'plan',
  'imageView',
  'imageGeneration',
  'enteredReviewMode',
  'exitedReviewMode',
  'contextCompaction',
])

export function projectCodexNativeTurnsToCodexItems(turns: Turn[] | undefined): CodexResponseItem[] {
  const items: CodexResponseItem[] = []
  for (const turn of turns ?? []) {
    if (turn.itemsView !== 'full') {
      continue
    }
    for (const item of turn.items) {
      items.push(...projectThreadItem(item, turn.id))
    }
  }
  return items
}

function projectThreadItem(item: ThreadItem, turnId: string): CodexResponseItem[] {
  switch (item.type) {
    case 'userMessage':
      return projectUserMessage(item.content, turnId)
    case 'hookPrompt':
      return projectOpaqueThreadItem(item, turnId)
    case 'agentMessage':
      return item.text
        ? [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: item.text }],
            ...(item.phase ? { phase: item.phase } : {}),
            ...codexTurnMetadata(turnId),
          }]
        : []
    case 'reasoning':
      return projectReasoningItem(item, turnId)
    default:
      return TOOL_LIKE_ITEM_TYPES.has(item.type)
        ? projectToolLikeItem(item, turnId)
        : projectOpaqueThreadItem(item, turnId)
  }
}

function projectUserMessage(content: UserInput[], turnId: string): CodexResponseItem[] {
  const projectedContent = content.flatMap(projectUserInput)
  if (projectedContent.length === 0) {
    return []
  }
  return [{
    type: 'message',
    role: 'user',
    content: projectedContent,
    ...codexTurnMetadata(turnId),
  }]
}

function projectUserInput(input: UserInput): CodexContentItem[] {
  switch (input.type) {
    case 'text':
      return input.text ? [{ type: 'input_text', text: input.text }] : []
    case 'image':
      return [{
        type: 'input_image',
        image_url: input.url,
        ...(input.detail ? { detail: input.detail } : {}),
      }]
    case 'localImage':
    case 'skill':
    case 'mention':
      return [{
        type: 'input_text',
        text: stringifyForCodex({ type: `codex.${input.type}`, value: input }),
      }]
  }
}

function projectReasoningItem(
  item: Extract<ThreadItem, { type: 'reasoning' }>,
  turnId: string,
): CodexResponseItem[] {
  const summary = item.summary
    .filter(Boolean)
    .map(text => ({ type: 'summary_text' as const, text }))
  const content = item.content
    .filter(Boolean)
    .map(text => ({ type: 'reasoning_text' as const, text }))

  if (summary.length === 0 && content.length === 0) {
    return []
  }

  return [{
    type: 'reasoning',
    summary,
    ...(content.length > 0 ? { content } : {}),
    encrypted_content: null,
    ...codexTurnMetadata(turnId),
  }]
}

function projectToolLikeItem(item: ThreadItem, turnId: string): CodexResponseItem[] {
  const codexItem = item as CodexAppServerItem
  const callId = item.id
  const toolName = readCodexToolName(codexItem)
  return [
    {
      type: 'function_call',
      name: toolName,
      arguments: stringifyForCodex(buildCodexToolArgs(codexItem)),
      call_id: callId,
      ...codexTurnMetadata(turnId),
    },
    {
      type: 'function_call_output',
      call_id: callId,
      output: stringifyForCodex(buildCodexToolResult(codexItem)),
      ...codexTurnMetadata(turnId),
    },
  ]
}

function projectOpaqueThreadItem(item: ThreadItem, turnId: string): CodexResponseItem[] {
  return [{
    type: 'message',
    role: 'assistant',
    content: [{
      type: 'output_text',
      text: stringifyForCodex({
        type: 'codex.thread_item',
        value: item,
      }),
    }],
    ...codexTurnMetadata(turnId),
  }]
}

function codexTurnMetadata(turnId: string): { metadata: { turn_id: string } } {
  return { metadata: { turn_id: turnId } }
}

function stringifyForCodex(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  }
  catch {
    return JSON.stringify({ unserializable: true })
  }
}
