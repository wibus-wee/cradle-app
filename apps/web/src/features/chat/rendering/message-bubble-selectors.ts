import type { UIMessage } from 'ai'
import type { AnchorHTMLAttributes } from 'react'

import type { useChatStore } from '~/store/chat'

import { readChatContinuationMetadata } from '../capabilities/chat-continuation-metadata'
import type {
  BangCommandMetadata,
  BangResultMetadata,
} from '../commands/bang-command-metadata'
import {
  readBangCommandMetadata,
  readBangResultMetadata,
} from '../commands/bang-command-metadata'
import type {
  ChatPluginContextMessagePart,
  ChatSkillContextMessagePart,
} from '../context/chat-context-parts'
import {
  isChatPluginContextPart,
  isChatSkillContextPart,
} from '../context/chat-context-parts'
import type {
  ChatRenderItem,
  ChatRenderSegment,
  FileMessagePart,
} from './chat-render-plan'
import {
  groupMessagePartRefs,
  isRuntimeUserInputToolPart,
  readRenderableToolPart,
} from './chat-render-plan'
import type { RenderableToolPart } from './tool-ui-classifier'
import { describeToolCall } from './tool-ui-classifier'

const CODEX_GOAL_COMMAND_PREFIX = '/goal '
const ACTIVE_TOOL_STATES = new Set(['input-streaming', 'input-available', 'approval-requested'])
const EMPTY_RENDER_SEGMENTS: ChatRenderSegment[] = []

export type ChatStoreSnapshot = ReturnType<typeof useChatStore.getState>
export type MessageTextTransform = (text: string) => string

export interface MessageFrame {
  id: string
  role: UIMessage['role']
  isSteerMessage: boolean
  isGoalMessage: boolean
  bangCommand: BangCommandMetadata | null
  bangResult: BangResultMetadata | null
  hasHiddenRuntimeUserInputTail: boolean
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function readMarkdownAnchorProps(value: unknown): AnchorHTMLAttributes<HTMLAnchorElement> {
  return value && typeof value === 'object'
    ? (value as AnchorHTMLAttributes<HTMLAnchorElement>)
    : {}
}

function readGoalMetadataObjective(message: UIMessage): string | null {
  const metadata = readRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readRecord(metadata.cradle)
  const goal = readRecord(cradleMetadata.goal)
  return typeof goal.objective === 'string' && goal.objective.trim().length > 0
    ? goal.objective.trim()
    : null
}

function readCodexGoalObjective(text: string): string | null {
  const normalized = text.trimStart()
  if (!normalized.startsWith(CODEX_GOAL_COMMAND_PREFIX)) {
    return null
  }
  const objective = normalized.slice(CODEX_GOAL_COMMAND_PREFIX.length).trimStart()
  return objective.length > 0 ? objective : null
}

export function readUserDisplayText(text: string): string {
  return readCodexGoalObjective(text) ?? text
}

function projectMessageText(message: UIMessage, textTransform?: MessageTextTransform): UIMessage {
  if (!textTransform) {
    return message
  }

  let changed = false
  const parts = message.parts.map((part) => {
    if (part.type !== 'text') {
      return part
    }

    const text = textTransform(part.text)
    if (text === part.text) {
      return part
    }

    changed = true
    return { ...part, text }
  })

  return changed ? { ...message, parts } : message
}

export function readMessageDisplayText(message: UIMessage, textTransform?: MessageTextTransform): string {
  const projected = projectMessageText(message, textTransform)
  const goalObjective = readGoalMetadataObjective(message)
  if (projected.role === 'user' && goalObjective) {
    return goalObjective
  }
  return projected.parts
    .flatMap(part =>
      part.type === 'text'
        ? [projected.role === 'user' ? readUserDisplayText(part.text) : part.text]
        : [])
    .join('\n')
}

export function isCodexGoalUserMessage(message: UIMessage): boolean {
  if (message.role === 'user' && readGoalMetadataObjective(message)) {
    return true
  }
  return (
    message.role === 'user'
    && readCodexGoalObjective(
      message.parts.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('\n'),
    ) !== null
  )
}

export function readMessageFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  textTransform?: MessageTextTransform,
): UIMessage | undefined {
  const message = (state.messagesMap.get(sessionId) ?? []).find(message => message.id === messageId)
  return message ? projectMessageText(message, textTransform) : undefined
}

export function readMessageFrameFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  textTransform?: MessageTextTransform,
): MessageFrame | null {
  const message = readMessageFromState(state, sessionId, messageId, textTransform)
  if (!message) {
    return null
  }
  const continuationMetadata = readChatContinuationMetadata(message)
  return {
    id: message.id,
    role: message.role,
    isSteerMessage: message.role === 'user' && continuationMetadata?.mode === 'steer',
    isGoalMessage: isCodexGoalUserMessage(message),
    bangCommand: message.role === 'user' ? readBangCommandMetadata(message) : null,
    bangResult: message.role === 'user' ? readBangResultMetadata(message) : null,
    hasHiddenRuntimeUserInputTail: hasHiddenRuntimeUserInputTail(message),
  }
}

export function areMessageFramesEqual(left: MessageFrame | null, right: MessageFrame | null): boolean {
  return (
    left?.id === right?.id
    && left?.role === right?.role
    && left?.isSteerMessage === right?.isSteerMessage
    && left?.isGoalMessage === right?.isGoalMessage
    && left?.bangCommand?.command === right?.bangCommand?.command
    && areBangResultsEqual(left?.bangResult ?? null, right?.bangResult ?? null)
    && left?.hasHiddenRuntimeUserInputTail === right?.hasHiddenRuntimeUserInputTail
  )
}

function hasHiddenRuntimeUserInputTail(message: UIMessage): boolean {
  const tail = message.parts.at(-1)
  if (!tail) {
    return false
  }

  const toolPart = readRenderableToolPart(tail)
  return toolPart ? isRuntimeUserInputToolPart(toolPart) : false
}

function areBangResultsEqual(
  left: BangResultMetadata | null,
  right: BangResultMetadata | null,
): boolean {
  return (
    left?.command === right?.command
    && left?.stdout === right?.stdout
    && left?.stderr === right?.stderr
    && left?.exitCode === right?.exitCode
    && left?.durationMs === right?.durationMs
    && left?.timedOut === right?.timedOut
    && left?.truncated === right?.truncated
  )
}

export function readRenderSegmentsFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  textTransform?: MessageTextTransform,
): ChatRenderSegment[] {
  const message = readMessageFromState(state, sessionId, messageId, textTransform)
  if (!message) {
    return EMPTY_RENDER_SEGMENTS
  }
  return groupMessagePartRefs({
    parts: message.parts,
    messageId: message.id,
    describeToolKind: part => describeToolCall(part).kind,
  })
}

export function areRenderSegmentsEqual(left: ChatRenderSegment[], right: ChatRenderSegment[]): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  for (let i = 0; i < left.length; i++) {
    if (!areRenderSegmentEqual(left[i], right[i])) {
      return false
    }
  }
  return true
}

function areRenderSegmentEqual(left: ChatRenderSegment, right: ChatRenderSegment): boolean {
  if (left.kind !== right.kind || left.key !== right.key) {
    return false
  }
  switch (left.kind) {
    case 'text':
      return (
        right.kind === 'text'
        && left.messageId === right.messageId
        && left.partIndex === right.partIndex
        && left.hasText === right.hasText
      )
    case 'reasoning':
    case 'file-attachment':
    case 'skill-context':
    case 'plugin-context':
      return (
        (right.kind === 'reasoning'
          || right.kind === 'file-attachment'
          || right.kind === 'skill-context'
          || right.kind === 'plugin-context')
        && left.kind === right.kind
        && left.messageId === right.messageId
        && left.partIndex === right.partIndex
      )
    case 'tool-call':
      return (
        right.kind === 'tool-call'
        && left.messageId === right.messageId
        && left.partIndex === right.partIndex
        && left.toolCallId === right.toolCallId
      )
    case 'tool-group':
      return (
        right.kind === 'tool-group'
        && left.uiKind === right.uiKind
        && areToolItemRefsEqual(left.items, right.items)
      )
    default:
      return false
  }
}

function areToolItemRefsEqual(
  left: Array<{ key: string, messageId: string, partIndex: number, toolCallId: string }>,
  right: Array<{ key: string, messageId: string, partIndex: number, toolCallId: string }>,
): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let i = 0; i < left.length; i++) {
    if (
      left[i].key !== right[i].key
      || left[i].messageId !== right[i].messageId
      || left[i].partIndex !== right[i].partIndex
      || left[i].toolCallId !== right[i].toolCallId
    ) {
      return false
    }
  }
  return true
}

export function readTextPartFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
  textTransform?: MessageTextTransform,
): string {
  const part = readMessageFromState(state, sessionId, messageId, textTransform)?.parts[partIndex]
  return part?.type === 'text' ? part.text : ''
}

export function readReasoningPartFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
): { text: string, state?: 'streaming' | 'done' } {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  if (part?.type !== 'reasoning') {
    return { text: '', state: 'done' }
  }
  return {
    text: part.text,
    state: (part as { state?: 'streaming' | 'done' }).state,
  }
}

export function areReasoningPartsEqual(
  left: { text: string, state?: 'streaming' | 'done' },
  right: { text: string, state?: 'streaming' | 'done' },
): boolean {
  return left.text === right.text && left.state === right.state
}

export function readFilePartFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
): FileMessagePart | null {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  return part?.type === 'file' ? part : null
}

export function readSkillContextPartFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
): ChatSkillContextMessagePart | null {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  return isChatSkillContextPart(part) ? part : null
}

export function readPluginContextPartFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
): ChatPluginContextMessagePart | null {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  return isChatPluginContextPart(part) ? part : null
}

export function readRenderableToolPartFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
): RenderableToolPart | null {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  return part ? readRenderableToolPart(part) : null
}

export function areRenderableToolPartsEqual(
  left: RenderableToolPart | null,
  right: RenderableToolPart | null,
): boolean {
  return left === right
}

export function areGroupedRenderableToolItemsEqual(
  left: Array<{ key: string, part: RenderableToolPart }>,
  right: Array<{ key: string, part: RenderableToolPart }>,
): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  for (let i = 0; i < left.length; i++) {
    if (left[i].key !== right[i].key || left[i].part !== right[i].part) {
      return false
    }
  }
  return true
}

export function readPlainTextFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  textTransform?: MessageTextTransform,
): string {
  const message = readMessageFromState(state, sessionId, messageId, textTransform)
  if (!message) {
    return ''
  }
  return readMessageDisplayText(message)
}

export function readPlainTextPresenceFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  textTransform?: MessageTextTransform,
): boolean {
  const message = readMessageFromState(state, sessionId, messageId, textTransform)
  return message?.parts.some(part => part.type === 'text' && part.text.length > 0) ?? false
}

export function readPlainTextLengthFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  textTransform?: MessageTextTransform,
): number {
  const message = readMessageFromState(state, sessionId, messageId, textTransform)
  if (!message) {
    return 0
  }
  return readMessageDisplayText(message).length
}

export function readActiveStreamingSegmentKey(segments: ChatRenderSegment[]): string | null {
  const tail = segments.at(-1)
  if (!tail || (tail.kind !== 'text' && tail.kind !== 'reasoning')) {
    return null
  }
  return tail.key
}

export function readActiveStreamingItemKey(items: ChatRenderItem[]): string | null {
  const tail = items.at(-1)
  if (!tail || (tail.kind !== 'text' && tail.kind !== 'reasoning')) {
    return null
  }
  return tail.key
}

export function hasActiveNonTextProgress(items: ChatRenderItem[]): boolean {
  return items.some((item) => {
    if (item.kind === 'reasoning') {
      return item.state === 'streaming'
    }
    if (item.kind === 'tool-call') {
      return isToolPartActive(item.part)
    }
    if (item.kind === 'tool-group') {
      return item.items.some(toolItem => isToolPartActive(toolItem.part))
    }
    return false
  })
}

export function isToolPartActive(part: RenderableToolPart): boolean {
  return ACTIVE_TOOL_STATES.has(part.state)
}

export function hasActiveNonTextSegmentProgress(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  segments: ChatRenderSegment[],
): boolean {
  return segments.some((segment) => {
    if (segment.kind === 'reasoning') {
      const part = readMessageFromState(state, sessionId, messageId)?.parts[segment.partIndex]
      return (
        part?.type === 'reasoning'
        && (part as { state?: 'streaming' | 'done' }).state === 'streaming'
      )
    }
    if (segment.kind === 'tool-call') {
      return isToolPartActiveInState(state, sessionId, segment.messageId, segment.partIndex)
    }
    if (segment.kind === 'tool-group') {
      return segment.items.some(toolItem =>
        isToolPartActiveInState(state, sessionId, toolItem.messageId, toolItem.partIndex))
    }
    return false
  })
}

function isToolPartActiveInState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
): boolean {
  const part = readRenderableToolPartFromState(state, sessionId, messageId, partIndex)
  return part ? isToolPartActive(part) : false
}

export function readToolApproval(
  part: RenderableToolPart,
): { id: string, approved?: boolean, reason?: string } | undefined {
  const approval = (part as { approval?: { id?: unknown, approved?: unknown, reason?: unknown } })
    .approval
  if (!approval || typeof approval.id !== 'string') {
    return undefined
  }
  return {
    id: approval.id,
    ...(typeof approval.approved === 'boolean' ? { approved: approval.approved } : {}),
    ...(typeof approval.reason === 'string' ? { reason: approval.reason } : {}),
  }
}
