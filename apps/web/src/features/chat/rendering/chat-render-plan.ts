import type { UIMessage } from 'ai'

import type {
  ChatPluginContextMessagePart,
  ChatSkillContextMessagePart,
} from '../context/chat-context-parts'
import {
  isChatPluginContextPart,
  isChatSkillContextPart,
} from '../context/chat-context-parts'
import { readBuiltinToolCallInputPayload, readBuiltinToolCallResultPayload, toolNameFromPart } from './chat-tool-entities'
import type { RenderableToolPart, ToolUiKind } from './tool-ui-classifier'
import { normalizeToolName } from './tool-ui-classifier'

export type MessagePart = UIMessage['parts'][number]
export type FileMessagePart = Extract<MessagePart, { type: 'file' }>

export interface ToolCallItemRef {
  key: string
  messageId: string
  partIndex: number
  toolCallId: string
}

export interface ToolCallRenderItem extends ToolCallItemRef {
  part: RenderableToolPart
}

export interface MessagePartRefBase {
  key: string
  messageId: string
  partIndex: number
}

export type ChatRenderSegment
  = | (MessagePartRefBase & { kind: 'text', hasText: boolean })
    | (MessagePartRefBase & { kind: 'reasoning' })
    | ({ kind: 'tool-call' } & ToolCallRenderItem)
    | { kind: 'tool-group', items: ToolCallRenderItem[], uiKind: ToolUiKind, key: string }
    | (MessagePartRefBase & { kind: 'skill-context' })
    | (MessagePartRefBase & { kind: 'plugin-context' })
    | (MessagePartRefBase & { kind: 'file-attachment' })

export type ChatRenderItem
  = | { kind: 'text', text: string, key: string }
    | { kind: 'reasoning', text: string, state?: 'streaming' | 'done', key: string }
    | ({ kind: 'tool-call' } & ToolCallRenderItem)
    | { kind: 'tool-group', items: ToolCallRenderItem[], uiKind: ToolUiKind, key: string }
    | { kind: 'skill-context', part: ChatSkillContextMessagePart, key: string }
    | { kind: 'plugin-context', part: ChatPluginContextMessagePart, key: string }
    | { kind: 'file-attachment', part: FileMessagePart, key: string }

export interface ExecutionPhaseSplit {
  executionItems: ChatRenderItem[]
  finalItems: ChatRenderItem[]
}

export interface SegmentExecutionPhaseSplit {
  executionItems: ChatRenderSegment[]
  finalItems: ChatRenderSegment[]
}

export interface ExecutionPhaseSplitOptions {
  describeToolKind: (part: RenderableToolPart) => ToolUiKind | null
}

export interface GroupMessagePartsInput {
  parts: MessagePart[]
  messageId: string
  describeToolKind: (part: RenderableToolPart) => ToolUiKind | null
}

export function readRenderableToolPart(part: MessagePart): RenderableToolPart | null {
  if (
    (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-'))
    || !('toolCallId' in part)
    || typeof part.toolCallId !== 'string'
  ) {
    return null
  }

  const record = part as Record<string, unknown>
  const state = typeof record.state === 'string' ? record.state : 'input-streaming'
  return {
    ...part,
    toolCallId: part.toolCallId,
    state,
  } as RenderableToolPart
}

export function isRuntimeUserInputToolPart(part: RenderableToolPart): boolean {
  const normalizedName = normalizeToolName(
    readBuiltinToolApiName(part.input)
    ?? readBuiltinToolApiName(part.output)
    ?? toolNameFromPart(part),
  )
  return (
    normalizedName === 'askuserquestion'
    || normalizedName === 'ask_user_question'
    || normalizedName === 'tool.request_user_input'
    || normalizedName === 'mcp.elicitation'
    || normalizedName === 'server_request_item_tool_requestuserinput'
    || normalizedName === 'server_request_mcpserver_elicitation_request'
  )
}

function readBuiltinToolApiName(value: unknown): string | null {
  return readBuiltinToolCallInputPayload(value)?.apiName
    ?? readBuiltinToolCallResultPayload(value)?.apiName
    ?? null
}

export function groupMessagePartRefs(input: GroupMessagePartsInput): ChatRenderSegment[] {
  const items: ChatRenderSegment[] = []

  for (let i = 0; i < input.parts?.length; i++) {
    const part = input.parts[i]
    const key
      = 'toolCallId' in part
        ? (part as { toolCallId: string }).toolCallId
        : `${input.messageId}-${part.type}-${i}`

    if (part.type === 'text') {
      items.push({
        kind: 'text',
        key,
        messageId: input.messageId,
        partIndex: i,
        hasText: part.text.trim().length > 0,
      })
    }
 else if (part.type === 'reasoning') {
      items.push({
        kind: 'reasoning',
        key,
        messageId: input.messageId,
        partIndex: i,
      })
    }
 else if (part.type === 'file') {
      items.push({
        kind: 'file-attachment',
        key,
        messageId: input.messageId,
        partIndex: i,
      })
    }
 else if (isChatSkillContextPart(part)) {
      items.push({
        kind: 'skill-context',
        key,
        messageId: input.messageId,
        partIndex: i,
      })
    }
 else if (isChatPluginContextPart(part)) {
      items.push({
        kind: 'plugin-context',
        key,
        messageId: input.messageId,
        partIndex: i,
      })
    }
 else {
      const toolPart = readRenderableToolPart(part)
      if (!toolPart) {
        continue
      }
      if (isRuntimeUserInputToolPart(toolPart)) {
        continue
      }
      const toolCallId = toolPart.toolCallId
      items.push({
        kind: 'tool-call',
        messageId: input.messageId,
        partIndex: i,
        toolCallId,
        key,
        part: toolPart,
      })
    }
  }

  return groupConsecutiveToolCalls(items, input.describeToolKind)
}

export function groupMessageParts(input: GroupMessagePartsInput): ChatRenderItem[] {
  const items: ChatRenderItem[] = []

  for (let i = 0; i < input.parts?.length; i++) {
    const part = input.parts[i]
    const key
      = 'toolCallId' in part
        ? (part as { toolCallId: string }).toolCallId
        : `${input.messageId}-${part.type}-${i}`

    if (part.type === 'text') {
      items.push({ kind: 'text', text: part.text, key })
    }
 else if (part.type === 'reasoning') {
      items.push({
        kind: 'reasoning',
        text: part.text,
        state: (part as { state?: 'streaming' | 'done' }).state,
        key,
      })
    }
 else if (part.type === 'file') {
      items.push({ kind: 'file-attachment', part, key })
    }
 else if (isChatSkillContextPart(part)) {
      items.push({ kind: 'skill-context', part: part as ChatSkillContextMessagePart, key })
    }
 else if (isChatPluginContextPart(part)) {
      items.push({ kind: 'plugin-context', part: part as ChatPluginContextMessagePart, key })
    }
 else {
      const toolPart = readRenderableToolPart(part)
      if (!toolPart) {
        continue
      }
      if (isRuntimeUserInputToolPart(toolPart)) {
        continue
      }
      const toolCallId = toolPart.toolCallId
      items.push({
        kind: 'tool-call',
        messageId: input.messageId,
        partIndex: i,
        toolCallId,
        key,
        part: toolPart,
      })
    }
  }

  return groupConsecutiveToolCalls(items, input.describeToolKind)
}

const GROUPABLE_KINDS = new Set<ToolUiKind>(['terminal', 'file-read', 'search', 'file-diff'])
const FINAL_REPLY_TOOL_KINDS = new Set<ToolUiKind>(['plan', 'plan-implementation'])

function groupConsecutiveToolCalls(
  items: ChatRenderItem[],
  describeToolKind: (part: RenderableToolPart) => ToolUiKind | null,
): ChatRenderItem[]
function groupConsecutiveToolCalls(
  items: ChatRenderSegment[],
  describeToolKind: (part: RenderableToolPart) => ToolUiKind | null,
): ChatRenderSegment[]
function groupConsecutiveToolCalls(
  items: Array<ChatRenderItem | ChatRenderSegment>,
  describeToolKind: (part: RenderableToolPart) => ToolUiKind | null,
): Array<ChatRenderItem | ChatRenderSegment> {
  const result: Array<ChatRenderItem | ChatRenderSegment> = []
  let i = 0
  while (i < items.length) {
    const item = items[i]
    if (item.kind !== 'tool-call') {
      result.push(item)
      i++
      continue
    }
    const uiKind = 'part' in item ? describeToolKind(item.part) : null
    if ('part' in item && item.part.state === 'approval-requested') {
      result.push(item)
      i++
      continue
    }
    if (!uiKind || !GROUPABLE_KINDS.has(uiKind)) {
      result.push(item)
      i++
      continue
    }
    const group: ToolCallRenderItem[] = [
      {
        key: item.key,
        messageId: item.messageId,
        partIndex: item.partIndex,
        toolCallId: item.toolCallId,
        part: item.part,
      },
    ]
    let j = i + 1
    while (j < items.length && items[j].kind === 'tool-call') {
      const nextItem = items[j] as Extract<
        ChatRenderItem | ChatRenderSegment,
        { kind: 'tool-call' }
      >
      const nextKind = 'part' in nextItem ? describeToolKind(nextItem.part) : null
      if ('part' in nextItem && nextItem.part.state === 'approval-requested') {
        break
      }
      if (nextKind !== uiKind) {
        break
      }
      group.push({
        key: nextItem.key,
        messageId: nextItem.messageId,
        partIndex: nextItem.partIndex,
        toolCallId: nextItem.toolCallId,
        part: nextItem.part,
      })
      j++
    }
    if (group.length >= 2) {
      result.push({
        kind: 'tool-group',
        items: group,
        uiKind,
        key: group[0].key,
      })
      i = j
    }
 else {
      result.push(item)
      i++
    }
  }
  return result
}

export function hasFinalReply(
  items: ChatRenderItem[],
  options: ExecutionPhaseSplitOptions,
): boolean {
  return splitExecutionPhase(items, options) !== null
}

export function splitExecutionPhase(
  items: ChatRenderItem[],
  options: ExecutionPhaseSplitOptions,
): ExecutionPhaseSplit | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item.kind !== 'text' || item.text.trim().length === 0) {
      continue
    }

    const previousItems = items.slice(0, index)
    const hasExecutionToolBeforeFinalText = previousItems
      .some(candidate => isExecutionPhaseToolItem(candidate, options))

    if (!hasExecutionToolBeforeFinalText) {
      continue
    }

    const retainedFinalItems = previousItems.filter(candidate =>
      shouldKeepToolWithFinalReply(candidate, options))
    const executionItems = previousItems.filter(candidate =>
      !shouldKeepToolWithFinalReply(candidate, options))

    return {
      executionItems,
      finalItems: [...retainedFinalItems, ...items.slice(index)],
    }
  }

  return null
}

export function splitSegmentExecutionPhase(
  items: ChatRenderSegment[],
  options: ExecutionPhaseSplitOptions,
): SegmentExecutionPhaseSplit | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item.kind !== 'text' || !item.hasText) {
      continue
    }

    const previousItems = items.slice(0, index)
    const hasExecutionToolBeforeFinalText = previousItems
      .some(candidate => isExecutionPhaseToolItem(candidate, options))

    if (!hasExecutionToolBeforeFinalText) {
      continue
    }

    const retainedFinalItems = previousItems.filter(candidate =>
      shouldKeepToolWithFinalReply(candidate, options))
    const executionItems = previousItems.filter(candidate =>
      !shouldKeepToolWithFinalReply(candidate, options))

    return {
      executionItems,
      finalItems: [...retainedFinalItems, ...items.slice(index)],
    }
  }

  return null
}

function isExecutionPhaseToolItem(
  item: ChatRenderItem | ChatRenderSegment,
  options: ExecutionPhaseSplitOptions,
): boolean {
  if (item.kind !== 'tool-call' && item.kind !== 'tool-group') {
    return false
  }
  return !shouldKeepToolWithFinalReply(item, options)
}

function shouldKeepToolWithFinalReply(
  item: ChatRenderItem | ChatRenderSegment,
  options: ExecutionPhaseSplitOptions,
): boolean {
  if (item.kind === 'tool-call') {
    const kind = options.describeToolKind(item.part)
    return kind !== null && FINAL_REPLY_TOOL_KINDS.has(kind)
  }
  if (item.kind === 'tool-group') {
    return FINAL_REPLY_TOOL_KINDS.has(item.uiKind)
  }
  return false
}
