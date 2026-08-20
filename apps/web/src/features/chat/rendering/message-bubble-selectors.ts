import { readCradlePartPayloadRef } from '@cradle/chat-runtime-contracts'
import type { UIMessage } from 'ai'
import type { AnchorHTMLAttributes } from 'react'

import type { useChatStore } from '~/store/chat'

import { readChatContinuationMetadata } from '../capabilities/chat-continuation-metadata'
import type { BangCommandMetadata, BangResultMetadata } from '../commands/bang-command-metadata'
import { readBangCommandMetadata, readBangResultMetadata } from '../commands/bang-command-metadata'
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
import type { ComposerPastedText } from '../pasted-text/pasted-text'
import { projectPastedTextPrompt } from '../pasted-text/pasted-text'
import type { RuntimeWarningMessagePart } from '../runtime-warning'
import { isRuntimeWarningMessagePart } from '../runtime-warning'
import type { ChatRenderItem, ChatRenderSegment, FileMessagePart } from './chat-render-plan'
import {
  groupMessagePartRefs,
  isRuntimeUserInputToolPart,
  readRenderableToolPart,
} from './chat-render-plan'
import type { RunTimingMetrics } from './run-debug-timings'
import type { RenderableToolPart } from './tool-ui-classifier'
import { describeToolCallCached } from './tool-ui-classifier'

const CODEX_GOAL_COMMAND_PREFIX = '/goal '
const ACTIVE_TOOL_STATES = new Set(['input-streaming', 'input-available', 'approval-requested'])

export type ChatStoreSnapshot = ReturnType<typeof useChatStore.getState>
export type MessageTextTransform = (text: string) => string

export interface MessageFrame {
  id: string
  role: UIMessage['role']
  isSteerMessage: boolean
  isGoalMessage: boolean
  bangCommand: BangCommandMetadata | null
  bangResult: BangResultMetadata | null
  /** Durable run identity stamped by the server on terminal assistant messages. */
  runId: string | null
  /** Compact durable timing projection retained with the terminal message. */
  runTimings: RunTimingMetrics | null
  hasHiddenRuntimeUserInputTail: boolean
}

export interface UserTextDisplayProjection {
  displayText: string
  pastedTexts: ComposerPastedText[]
  plainText: string
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

export function readUserTextDisplay(text: string): UserTextDisplayProjection {
  const projection = projectPastedTextPrompt(text)
  const displayText = readCodexGoalObjective(projection.text) ?? projection.text
  const plainText = [displayText, ...projection.pastedTexts.map(item => item.text)]
    .filter(part => part.trim().length > 0)
    .join('\n\n')

  return {
    displayText,
    pastedTexts: projection.pastedTexts,
    plainText,
  }
}

export function readUserDisplayText(text: string): string {
  return readUserTextDisplay(text).displayText
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

export function readMessageDisplayText(
  message: UIMessage,
  textTransform?: MessageTextTransform,
): string {
  const projected = projectMessageText(message, textTransform)
  const goalObjective = readGoalMetadataObjective(message)
  if (projected.role === 'user' && goalObjective) {
    const pastedTexts = projected.parts.flatMap(part =>
      part.type === 'text' ? readUserTextDisplay(part.text).pastedTexts : [])
    return [goalObjective, ...pastedTexts.map(item => item.text)]
      .filter(part => part.trim().length > 0)
      .join('\n\n')
  }
  return projected.parts
    .flatMap(part =>
      part.type === 'text'
        ? [projected.role === 'user' ? readUserTextDisplay(part.text).plainText : part.text]
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
  const message = (state.messagesMap.get(sessionId) ?? []).find(
    message => message.id === messageId,
  )
  return message ? projectMessageText(message, textTransform) : undefined
}

export function readMessageFrame(message: UIMessage): MessageFrame {
  const continuationMetadata = readChatContinuationMetadata(message)
  const runMetadata = message.role === 'assistant' ? readRunMetadata(message) : null
  return {
    id: message.id,
    role: message.role,
    isSteerMessage: message.role === 'user' && continuationMetadata?.mode === 'steer',
    isGoalMessage: isCodexGoalUserMessage(message),
    bangCommand: message.role === 'user' ? readBangCommandMetadata(message) : null,
    bangResult: message.role === 'user' ? readBangResultMetadata(message) : null,
    runId: runMetadata?.runId ?? null,
    runTimings: runMetadata?.timings ?? null,
    hasHiddenRuntimeUserInputTail: hasHiddenRuntimeUserInputTail(message),
  }
}

function readRunMetadata(message: UIMessage): {
  runId: string | null
  timings: RunTimingMetrics | null
} {
  const metadata = readRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readRecord(metadata.cradle)
  const run = readRecord(cradleMetadata.run)
  const timings = readRecord(run.timings)
  const durationMs = readFiniteTiming(run.durationMs)
  const hasTimingProjection = Object.keys(timings).length > 0
  return {
    runId: typeof run.runId === 'string' && run.runId.length > 0 ? run.runId : null,
    timings: hasTimingProjection || durationMs !== null
      ? {
          acceptMs: readFiniteTiming(timings.acceptMs),
          ttfbMs: readFiniteTiming(timings.ttfbMs),
          ttftMs: readFiniteTiming(timings.ttftMs),
          workedMs: readFiniteTiming(timings.workedMs),
          totalMs: readFiniteTiming(timings.totalMs) ?? durationMs,
        }
      : null,
  }
}

function readFiniteTiming(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null
}

function hasHiddenRuntimeUserInputTail(message: UIMessage): boolean {
  const tail = message.parts.at(-1)
  if (!tail) {
    return false
  }

  const toolPart = readRenderableToolPart(tail)
  return toolPart ? isRuntimeUserInputToolPart(toolPart) : false
}

export function readRenderSegments(message: UIMessage): ChatRenderSegment[] {
  return groupMessagePartRefs({
    parts: message.parts,
    messageId: message.id,
    describeToolKind: part => describeToolCallCached(part).kind,
  })
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

export interface PartOverflowNotice {
  originalChars: number
  blobId: string
}

/** Overflow notice for a text/reasoning part whose remainder lives in a blob. */
export function readPartOverflowNotice(
  part: UIMessage['parts'][number] | null | undefined,
): PartOverflowNotice | null {
  if (!part || (part.type !== 'text' && part.type !== 'reasoning')) {
    return null
  }
  const ref = readCradlePartPayloadRef(part.providerMetadata)
  if (!ref) {
    return null
  }
  return {
    originalChars: ref.originalChars,
    blobId: ref.blobId,
  }
}

export function readTextPartOverflowFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
  textTransform?: MessageTextTransform,
): PartOverflowNotice | null {
  const part = readMessageFromState(state, sessionId, messageId, textTransform)?.parts[partIndex]
  return readPartOverflowNotice(part)
}

export function readReasoningPartFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
): { text: string, state?: 'streaming' | 'done', overflow: PartOverflowNotice | null } {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  if (part?.type !== 'reasoning') {
    return { text: '', state: 'done', overflow: null }
  }
  return {
    text: part.text,
    state: (part as { state?: 'streaming' | 'done' }).state,
    overflow: readPartOverflowNotice(part),
  }
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

export interface MessageImageAttachment {
  segmentKey: string
  part: FileMessagePart
}

export function readMessageImageAttachmentsFromMessage(
  message: UIMessage | undefined,
  segments: ChatRenderSegment[],
): MessageImageAttachment[] {
  if (!message) {
    return []
  }
  return segments.flatMap((segment) => {
    if (segment.kind !== 'file-attachment') {
      return []
    }
    const part = message.parts[segment.partIndex]
    return part?.type === 'file' && part.mediaType.startsWith('image/')
      ? [{ segmentKey: segment.key, part }]
      : []
  })
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

export function readIntentContextPartFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
): ChatIntentContextMessagePart | null {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  return isChatIntentContextPart(part) ? part : null
}

export function readFileLineCommentContextPartFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
): ChatFileLineCommentContextMessagePart | null {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  return isChatFileLineCommentContextPart(part) ? part : null
}

export function readRuntimeWarningPartFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
): RuntimeWarningMessagePart | null {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  return isRuntimeWarningMessagePart(part) ? part : null
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
  return message ? readMessageDisplayText(message).length > 0 : false
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
  if (!tail || (tail.kind !== 'text' && tail.kind !== 'activity-feed')) {
    return null
  }
  return tail.key
}

export function readActiveStreamingItemKey(items: ChatRenderItem[]): string | null {
  const tail = items.at(-1)
  if (!tail || (tail.kind !== 'text' && tail.kind !== 'activity-feed')) {
    return null
  }
  return tail.key
}

export function hasActiveNonTextProgress(items: ChatRenderItem[]): boolean {
  return items.some((item) => {
    if (item.kind === 'tool-call') {
      return isToolPartActive(item.part)
    }
    if (item.kind === 'activity-feed') {
      return item.entries.some(entry =>
        entry.entryKind === 'reasoning'
          ? entry.state === 'streaming'
          : isToolPartActive(entry.part))
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
    if (segment.kind === 'tool-call') {
      return isToolPartActiveInState(state, sessionId, segment.messageId, segment.partIndex)
    }
    if (segment.kind === 'activity-feed') {
      return segment.entries.some((entry) => {
        if (entry.entryKind === 'reasoning') {
          const part = readMessageFromState(state, sessionId, messageId)?.parts[entry.partIndex]
          return (
            part?.type === 'reasoning'
            && (part as { state?: 'streaming' | 'done' }).state === 'streaming'
          )
        }
        return isToolPartActiveInState(state, sessionId, entry.messageId, entry.partIndex)
      })
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
