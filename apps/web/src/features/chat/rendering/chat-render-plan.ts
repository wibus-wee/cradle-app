import type { UIMessage } from 'ai'

import type {
  ChatFileLineCommentContextMessagePart,
  ChatIntentContextMessagePart,
  ChatPluginContextMessagePart,
  ChatSkillContextMessagePart,
} from '../context/chat-context-parts'
import {
  isChatFileLineCommentContextPart,
  isChatIntentContextPart,
  isChatPluginContextPart,
  isChatSkillContextPart,
} from '../context/chat-context-parts'
import type { RuntimeWarningMessagePart } from '../runtime-warning'
import { isRuntimeWarningMessagePart } from '../runtime-warning'
import {
  readBuiltinToolCallInputPayload,
  readBuiltinToolCallResultPayload,
  toolNameFromPart,
} from './chat-tool-entities'
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

export type ActivityFeedEntryRef
  = | ({ entryKind: 'tool-call' } & ToolCallRenderItem)
    | (MessagePartRefBase & { entryKind: 'reasoning' })

export type ActivityFeedEntryItem
  = | ({ entryKind: 'tool-call' } & ToolCallRenderItem)
    | {
      entryKind: 'reasoning'
      text: string
      state?: 'streaming' | 'done'
      key: string
    }

export type ChatRenderSegment
  = | (MessagePartRefBase & { kind: 'text', hasText: boolean })
    | ({ kind: 'tool-call' } & ToolCallRenderItem)
    | { kind: 'activity-feed', entries: ActivityFeedEntryRef[], key: string }
    | (MessagePartRefBase & { kind: 'skill-context' })
    | (MessagePartRefBase & { kind: 'plugin-context' })
    | (MessagePartRefBase & { kind: 'intent-context' })
    | (MessagePartRefBase & { kind: 'file-line-comment-context' })
    | (MessagePartRefBase & { kind: 'file-attachment' })
    | (MessagePartRefBase & { kind: 'runtime-warning' })

export type ChatRenderItem
  = | { kind: 'text', text: string, key: string }
    | ({ kind: 'tool-call' } & ToolCallRenderItem)
    | { kind: 'activity-feed', entries: ActivityFeedEntryItem[], key: string }
    | { kind: 'skill-context', part: ChatSkillContextMessagePart, key: string }
    | { kind: 'plugin-context', part: ChatPluginContextMessagePart, key: string }
    | { kind: 'intent-context', part: ChatIntentContextMessagePart, key: string }
    | { kind: 'file-line-comment-context', part: ChatFileLineCommentContextMessagePart, key: string }
    | { kind: 'file-attachment', part: FileMessagePart, key: string }
    | { kind: 'runtime-warning', part: RuntimeWarningMessagePart, key: string }

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
  return (
    readBuiltinToolCallInputPayload(value)?.apiName
    ?? readBuiltinToolCallResultPayload(value)?.apiName
    ?? null
  )
}

/**
 * Intermediate items before feed collection: reasoning parts are not segments of
 * their own — they only exist as activity-feed entries after `collectActivityFeeds`.
 */
type PendingRenderSegment = ChatRenderSegment | (MessagePartRefBase & { kind: 'reasoning' })
type PendingRenderItem
  = | ChatRenderItem
    | { kind: 'reasoning', text: string, state?: 'streaming' | 'done', key: string }

export function groupMessagePartRefs(input: GroupMessagePartsInput): ChatRenderSegment[] {
  const items: PendingRenderSegment[] = []

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
 else if (isChatIntentContextPart(part)) {
      items.push({
        kind: 'intent-context',
        key,
        messageId: input.messageId,
        partIndex: i,
      })
    }
 else if (isChatFileLineCommentContextPart(part)) {
      items.push({
        kind: 'file-line-comment-context',
        key,
        messageId: input.messageId,
        partIndex: i,
      })
    }
 else if (isRuntimeWarningMessagePart(part)) {
      items.push({
        kind: 'runtime-warning',
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

  return collectActivityFeeds(items, input.describeToolKind)
}

export function groupMessageParts(input: GroupMessagePartsInput): ChatRenderItem[] {
  const items: PendingRenderItem[] = []

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
 else if (isChatIntentContextPart(part)) {
      items.push({ kind: 'intent-context', part: part as ChatIntentContextMessagePart, key })
    }
 else if (isChatFileLineCommentContextPart(part)) {
      items.push({
        kind: 'file-line-comment-context',
        part: part as ChatFileLineCommentContextMessagePart,
        key,
      })
    }
 else if (isRuntimeWarningMessagePart(part)) {
      items.push({ kind: 'runtime-warning', part, key })
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

  return collectActivityFeeds(items, input.describeToolKind)
}

const FINAL_REPLY_TOOL_KINDS = new Set<ToolUiKind>(['plan', 'plan-implementation', 'artifact'])

type FeedEntry = ActivityFeedEntryRef | ActivityFeedEntryItem

/**
 * Tool calls that stay as standalone segments (and break the feed):
 * approval requests need prominent action UI; plan kinds are final deliverables.
 */
function isFeedEligibleToolCall(
  item: Extract<ChatRenderItem | ChatRenderSegment, { kind: 'tool-call' }>,
  describeToolKind: (part: RenderableToolPart) => ToolUiKind | null,
): boolean {
  if (item.part.state === 'approval-requested') {
    return false
  }
  const uiKind = describeToolKind(item.part)
  return uiKind === null || !FINAL_REPLY_TOOL_KINDS.has(uiKind)
}

function collectActivityFeeds(
  items: PendingRenderItem[],
  describeToolKind: (part: RenderableToolPart) => ToolUiKind | null,
): ChatRenderItem[]
function collectActivityFeeds(
  items: PendingRenderSegment[],
  describeToolKind: (part: RenderableToolPart) => ToolUiKind | null,
): ChatRenderSegment[]
function collectActivityFeeds(
  items: Array<PendingRenderItem | PendingRenderSegment>,
  describeToolKind: (part: RenderableToolPart) => ToolUiKind | null,
): Array<ChatRenderItem | ChatRenderSegment> {
  const result: Array<ChatRenderItem | ChatRenderSegment> = []
  let feed: FeedEntry[] = []

  const flushFeed = () => {
    if (feed.length === 0) {
      return
    }
    result.push({
      kind: 'activity-feed',
      entries: feed,
      key: feed[0].key,
    } as ChatRenderItem | ChatRenderSegment)
    feed = []
  }

  for (const item of items) {
    if (item.kind === 'tool-call') {
      if (isFeedEligibleToolCall(item, describeToolKind)) {
        feed.push({
          entryKind: 'tool-call',
          key: item.key,
          messageId: item.messageId,
          partIndex: item.partIndex,
          toolCallId: item.toolCallId,
          part: item.part,
        })
      }
      else {
        flushFeed()
        result.push(item)
      }
      continue
    }
    if (item.kind === 'reasoning') {
      feed.push(
        'text' in item
          ? {
              entryKind: 'reasoning',
              key: item.key,
              text: item.text as string,
              state: item.state,
            }
          : {
              entryKind: 'reasoning',
              key: item.key,
              messageId: item.messageId,
              partIndex: item.partIndex,
            },
      )
      continue
    }
    flushFeed()
    result.push(item)
  }
  flushFeed()
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
    const hasExecutionToolBeforeFinalText = previousItems.some(candidate =>
      isExecutionPhaseToolItem(candidate, options))

    if (!hasExecutionToolBeforeFinalText) {
      continue
    }

    const retainedFinalItems = previousItems.filter(candidate =>
      shouldKeepToolWithFinalReply(candidate, options))
    const executionItems = previousItems.filter(
      candidate => !shouldKeepToolWithFinalReply(candidate, options),
    )

    // Fold intermediate narration/reasoning/tools; only the trailing final text stays visible.
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
    const hasExecutionToolBeforeFinalText = previousItems.some(candidate =>
      isExecutionPhaseToolItem(candidate, options))

    if (!hasExecutionToolBeforeFinalText) {
      continue
    }

    const retainedFinalItems = previousItems.filter(candidate =>
      shouldKeepToolWithFinalReply(candidate, options))
    const executionItems = previousItems.filter(
      candidate => !shouldKeepToolWithFinalReply(candidate, options),
    )

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
  if (item.kind === 'activity-feed') {
    return true
  }
  if (item.kind !== 'tool-call') {
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
  return false
}
