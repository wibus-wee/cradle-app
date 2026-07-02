import { Streamdown } from '@cradle/streamdown'
import {
  CheckLine as CheckIcon,
  CopyLine as CopyIcon,
  FileLine as FileIcon,
  HashtagLine as HashIcon,
  HeartbeatLine as ActivityIcon,
  PencilLine as PencilIcon,
  PicLine as ImageIcon,
  StopwatchLine as TimerIcon,
  TargetLine as TargetIcon,
} from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import type { AnchorHTMLAttributes } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'

import { getChatRunsByRunIdSnapshotOptions } from '~/api-gen/@tanstack/react-query.gen'
import type { GetChatRunsByRunIdSnapshotResponse } from '~/api-gen/types.gen'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'
import { formatShortDurationMs } from '~/lib/number-format'
import type { ChatRunDisplayMeta } from '~/store/chat'
import { chatSelectors, useChatStore } from '~/store/chat'
import { useSessionLayoutStore } from '~/store/session-layout'
import { STREAMDOWN_RENDER_OPTIONS } from '~/store/streamdown'

import { readChatContinuationMetadata } from '../capabilities/chat-continuation-metadata'
import type {
  BangCommandMetadata,
  BangResultMetadata,
} from '../commands/bang-command-metadata'
import {
  readBangCommandMetadata,
  readBangResultMetadata,
} from '../commands/bang-command-metadata'
import { AppshotAttachmentCard } from '../composer/appshot-attachment'
import { readCradleAppshotMetadata } from '../composer/appshot-attachment-model'
import type {
  ChatPluginContextMessagePart,
  ChatSkillContextMessagePart,
} from '../context/chat-context-parts'
import {
  isChatPluginContextPart,
  isChatSkillContextPart,
  readPluginContextLabel,
  readPluginContextPart,
  readSkillContextLabel,
  readSkillContextPart,
} from '../context/chat-context-parts'
import { PluginMentionIcon } from '../mentions/plugin-mention-icon'
import { SkillMentionToken } from '../mentions/skill-mention-token'
import { GroupedToolCallBlock, ToolCallBlock } from './blocks'
import { BangCommandBlock, BangCommandPromptBlock } from './blocks/bang-command-block'
import { ReasoningBlock } from './blocks/reasoning-block'
import type {
  ChatRenderItem,
  ChatRenderSegment,
  FileMessagePart,
} from './chat-render-plan'
import {
  groupMessagePartRefs,
  groupMessageParts,
  isRuntimeUserInputToolPart,
  readRenderableToolPart,
  splitExecutionPhase,
  splitSegmentExecutionPhase,
} from './chat-render-plan'
import { toolNameFromPart } from './chat-tool-entities'
import { ImageLightbox } from './image-lightbox'
import { MarkdownFileLink } from './markdown-file-link'
import type { RenderableToolPart } from './tool-ui-classifier'
import { describeToolCall } from './tool-ui-classifier'

const THINKING_IDLE_DELAY_MS = 900
const MESSAGE_STREAMING_ANIMATION_MAX_CHARS = 12000
const ACTIVE_TOOL_STATES = new Set(['input-streaming', 'input-available', 'approval-requested'])
const CODEX_GOAL_COMMAND_PREFIX = '/goal '
const STEER_MESSAGE_CONTAINER_CLASS = 'max-w-[78%]'
const STEER_MESSAGE_BUBBLE_CLASS
  = 'rounded-br-sm bg-background px-3 py-2 text-muted-foreground shadow-[inset_0_0_0_1px_hsl(var(--border)/0.45)]'
const FILE_ATTACHMENT_CLASS
  = 'my-1 block w-full min-w-0 max-w-full overflow-hidden rounded-md border border-border/60 bg-background/60'
const IMAGE_ATTACHMENT_GRID_ITEM_CLASS = 'min-w-0 max-w-[300px] flex-1 basis-[calc(50%-0.25rem)]'

export type MessageTextTransform = (text: string) => string

export interface MessageBubbleEditAction {
  busy: boolean
  disabled: boolean
  label: string
  title: string
  onEdit: () => void
}

function SteerMessageLabel() {
  const { t } = useTranslation('chat')
  return (
    <div className="mb-1 flex justify-end pr-1">
      <span className="text-[11px] font-medium text-muted-foreground">
        {t('continuation.steer.label')}
      </span>
    </div>
  )
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readMarkdownAnchorProps(value: unknown): AnchorHTMLAttributes<HTMLAnchorElement> {
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

function readUserDisplayText(text: string): string {
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

function readMessageDisplayText(message: UIMessage, textTransform?: MessageTextTransform): string {
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

function isCodexGoalUserMessage(message: UIMessage): boolean {
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

function FileAttachmentBlock({ part, onClick }: { part: FileMessagePart, onClick?: () => void }) {
  const label = part.filename ?? part.mediaType
  const isImage = part.mediaType.startsWith('image/')
  const appshotMetadata = readCradleAppshotMetadata(part)

  if (appshotMetadata) {
    return <AppshotAttachmentCard variant="thread" metadata={appshotMetadata} />
  }

  const content = (
    <>
      {isImage && (
        <img
          src={part.url}
          alt={label}
          className="h-auto max-h-48 w-full max-w-full object-cover"
          loading="lazy"
          data-testid="chat-file-attachment-image"
        />
      )}
      <div className="flex min-w-0 items-center gap-2 px-2.5 py-2 text-xs">
        {isImage
? (
          <ImageIcon className="size-3.5 shrink-0 !text-muted-foreground" aria-hidden="true" />
        )
: (
          <FileIcon className="size-3.5 shrink-0 !text-muted-foreground" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">{label}</div>
          <div className="truncate text-[11px] text-muted-foreground">{part.mediaType}</div>
        </div>
      </div>
    </>
  )

  if (isImage && onClick) {
    return (
      <button
        type="button"
        className={cn(FILE_ATTACHMENT_CLASS, 'text-left transition-opacity hover:opacity-80')}
        data-testid="chat-file-attachment"
        onClick={onClick}
        aria-label={`Preview ${label}`}
      >
        {content}
      </button>
    )
  }

  return (
    <div className={FILE_ATTACHMENT_CLASS} data-testid="chat-file-attachment">
      {content}
    </div>
  )
}

function SkillContextBlock({ part }: { part: ChatSkillContextMessagePart }) {
  const skill = readSkillContextPart(part)
  if (!skill) {
    return null
  }
  return <SkillMentionToken name={readSkillContextLabel(skill)} className="mx-1" />
}

function PluginContextBlock({ part }: { part: ChatPluginContextMessagePart }) {
  const plugin = readPluginContextPart(part)
  if (!plugin) {
    return null
  }
  return (
    <span className="mx-0.5 inline-flex items-center gap-0.5 align-baseline text-[0.8125em] font-medium text-sky-600 dark:text-sky-400">
      <PluginMentionIcon iconUrl={plugin.iconUrl} className="size-3" />
@
{readPluginContextLabel(plugin)}
    </span>
  )
}

function RunDebugCaption({ messageId }: { messageId: string }) {
  const meta = useChatStore(chatSelectors.runDisplayMeta(messageId), (a, b) => a === b)
  const { data: runSnapshot } = useQuery({
    ...getChatRunsByRunIdSnapshotOptions({ path: { runId: meta?.runId ?? '' } }),
    enabled: Boolean(meta?.runId),
    refetchInterval: query => query.state.data?.status === 'running' ? 1000 : false,
  })
  if (!meta) {
    return null
  }

  const localTimings = readLocalRunTimings(meta)
  const snapshotTimings = runSnapshot ? readRunSnapshotTimings(runSnapshot) : null
  const ttfbMs = snapshotTimings ? snapshotTimings.ttfbMs : localTimings.ttfbMs
  const ttftMs = snapshotTimings ? snapshotTimings.ttftMs : localTimings.ttftMs
  const totalMs = snapshotTimings?.totalMs ?? localTimings.totalMs
  const shortRunId = meta.runId ? `${meta.runId.slice(0, 8)}…` : 'pending'

  return (
    <TooltipProvider delayDuration={250}>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <Tooltip>
          <TooltipTrigger
            render={(
              <Badge
                variant="outline"
                className="h-5 max-w-full gap-1 border-border/50 bg-muted/25 px-1.5 font-mono font-normal text-[10px] text-muted-foreground tabular-nums"
              >
                <HashIcon className="size-3" aria-hidden="true" />
                <span className="truncate">{shortRunId}</span>
              </Badge>
            )}
          />
          <TooltipContent sideOffset={6}>
            {meta.runId ?? 'Run has not been assigned yet'}
          </TooltipContent>
        </Tooltip>
        <MetricBadge
          icon={<ActivityIcon className="size-3" aria-hidden="true" />}
          label="TTFB"
          value={ttfbMs}
        />
        <MetricBadge
          icon={<TimerIcon className="size-3" aria-hidden="true" />}
          label="TTFT"
          value={ttftMs}
        />
        {totalMs !== null && (
          <MetricBadge
            icon={<CheckIcon className="size-3" aria-hidden="true" />}
            label="Done"
            value={totalMs}
          />
        )}
      </div>
    </TooltipProvider>
  )
}

type RunTimingMetrics = {
  ttfbMs: number | null
  ttftMs: number | null
  totalMs: number | null
}

type RunSnapshotEvent = GetChatRunsByRunIdSnapshotResponse['events'][number]

const TERMINAL_CHUNK_TYPES = new Set(['finish', 'abort', 'error'])
const NON_RESPONSE_SNAPSHOT_PHASES = new Set([
  'run_started',
  'stream_finished',
  'stream_failed',
  'run_finalized',
  'usage',
  'step_usage',
])

function readLocalRunTimings(meta: ChatRunDisplayMeta): RunTimingMetrics {
  return {
    ttfbMs: meta.firstEventAtMs === null ? null : Math.max(0, meta.firstEventAtMs - meta.requestStartedAtMs),
    ttftMs: meta.firstContentAtMs === null ? null : Math.max(0, meta.firstContentAtMs - meta.requestStartedAtMs),
    totalMs: meta.completedAtMs === null ? null : Math.max(0, meta.completedAtMs - meta.requestStartedAtMs),
  }
}

function readRunSnapshotTimings(snapshot: GetChatRunsByRunIdSnapshotResponse): RunTimingMetrics {
  const firstResponseEvent = snapshot.events.find(isResponseSnapshotEvent)
  const firstTextDeltaEvent = snapshot.events.find(event => event.phase === 'model_text_first_delta')
  return {
    ttfbMs: firstResponseEvent ? Math.max(0, firstResponseEvent.occurredAt - snapshot.startedAt) : null,
    ttftMs: firstTextDeltaEvent ? Math.max(0, firstTextDeltaEvent.occurredAt - snapshot.startedAt) : null,
    totalMs: snapshot.completedAt == null ? null : Math.max(0, snapshot.completedAt - snapshot.startedAt),
  }
}

function isResponseSnapshotEvent(event: RunSnapshotEvent): boolean {
  return Boolean(
    event.chunkType
    && !TERMINAL_CHUNK_TYPES.has(event.chunkType)
    && !NON_RESPONSE_SNAPSHOT_PHASES.has(event.phase),
  )
}

function MetricBadge({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number | null
}) {
  return (
    <Badge
      variant="ghost"
      className="h-5 gap-1 px-1.5 font-normal text-[10px] text-muted-foreground/80 tabular-nums"
    >
      {icon}
      <span>{label}</span>
      <span className="font-mono">
        {value === null ? '…' : formatShortDurationMs(value).replaceAll(' ', '')}
      </span>
    </Badge>
  )
}

function ThinkingPlaceholder() {
  const { t } = useTranslation('chat')

  return (
    <div
      data-testid="message-bubble-thinking-placeholder"
      className="mt-3 flex h-6 w-full items-center overflow-hidden text-xs text-muted-foreground/70"
      aria-live="polite"
    >
      <span
        className={cn(
          'inline-flex items-center font-medium',
          '[mask-image:linear-gradient(90deg,rgba(0,0,0,0.4)_0%,black_36%,black_64%,rgba(0,0,0,0.4)_100%)] [mask-size:220%_100%]',
          '[-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,0.4)_0%,black_36%,black_64%,rgba(0,0,0,0.4)_100%)] [-webkit-mask-size:220%_100%]',
          'animate-[shimmer_2.8s_linear_infinite]',
        )}
      >
        {t('status.thinking')}
      </span>
    </div>
  )
}

function GoalMessageLabel() {
  return (
    <div className="mb-1 flex justify-end pr-1">
      <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase text-muted-foreground/60">
        <TargetIcon className="size-3" aria-hidden="true" />
        Goal
      </span>
    </div>
  )
}

function useTextStreamIdle(enabled: boolean, textLength: number): boolean {
  const streamKey = enabled ? textLength : null
  const [idleStreamKey, setIdleStreamKey] = useState<number | null>(null)

  useEffect(() => {
    if (streamKey === null) {
      return
    }

    const timer = window.setTimeout(() => {
      setIdleStreamKey(streamKey)
    }, THINKING_IDLE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [streamKey])

  return streamKey !== null && idleStreamKey === streamKey
}

function hasActiveNonTextProgress(items: ChatRenderItem[]): boolean {
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

function isToolPartActive(part: RenderableToolPart): boolean {
  return ACTIVE_TOOL_STATES.has(part.state)
}

function hasActiveNonTextSegmentProgress(
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

/* ─── Execution Phase Fold ──────────────────────────────────────── */

function ExecutionPhaseFold({
  children,
  defaultOpen = false,
}: {
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultOpen)

  return (
    <div className="my-1">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setExpanded(v => !v)}
        className="h-6 px-1.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground"
      >
        {expanded ? 'Hide execution details' : 'Show execution details'}
      </Button>
      {expanded && (
        <div className="overflow-hidden -mx-3 px-3">
          <div className="mt-1 space-y-1">{children}</div>
        </div>
      )}
    </div>
  )
}

/* ─── Main Component ────────────────────────────────────────────── */

const EMPTY_RENDER_SEGMENTS: ChatRenderSegment[] = []

interface MessageBubbleProps {
  message: UIMessage
  isStreaming: boolean
  executionDetailsDefaultOpen?: boolean
  presentation?: 'thread' | 'export'
  sessionId?: string
  onToolApprovalResponse?: (response: {
    messageId: string
    approvalId: string
    approved: boolean
  }) => void
}

type ChatStoreSnapshot = ReturnType<typeof useChatStore.getState>

interface MessageFrame {
  id: string
  role: UIMessage['role']
  isSteerMessage: boolean
  isGoalMessage: boolean
  bangCommand: BangCommandMetadata | null
  bangResult: BangResultMetadata | null
  hasHiddenRuntimeUserInputTail: boolean
}

function readMessageFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  textTransform?: MessageTextTransform,
): UIMessage | undefined {
  const message = (state.messagesMap.get(sessionId) ?? []).find(message => message.id === messageId)
  return message ? projectMessageText(message, textTransform) : undefined
}

function readMessageFrameFromState(
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

function areMessageFramesEqual(left: MessageFrame | null, right: MessageFrame | null): boolean {
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

function readRenderSegmentsFromState(
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

function areRenderSegmentsEqual(left: ChatRenderSegment[], right: ChatRenderSegment[]): boolean {
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

function readTextPartFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
  textTransform?: MessageTextTransform,
): string {
  const part = readMessageFromState(state, sessionId, messageId, textTransform)?.parts[partIndex]
  return part?.type === 'text' ? part.text : ''
}

function readReasoningPartFromState(
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

function areReasoningPartsEqual(
  left: { text: string, state?: 'streaming' | 'done' },
  right: { text: string, state?: 'streaming' | 'done' },
): boolean {
  return left.text === right.text && left.state === right.state
}

function readFilePartFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
): FileMessagePart | null {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  return part?.type === 'file' ? part : null
}

function readSkillContextPartFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
): ChatSkillContextMessagePart | null {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  return isChatSkillContextPart(part) ? part : null
}

function readPluginContextPartFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
): ChatPluginContextMessagePart | null {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  return isChatPluginContextPart(part) ? part : null
}

function readRenderableToolPartFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  partIndex: number,
): RenderableToolPart | null {
  const part = readMessageFromState(state, sessionId, messageId)?.parts[partIndex]
  return part ? readRenderableToolPart(part) : null
}

function areRenderableToolPartsEqual(
  left: RenderableToolPart | null,
  right: RenderableToolPart | null,
): boolean {
  return left === right
}

function areGroupedRenderableToolItemsEqual(
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

function readPlainTextFromState(
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

function readPlainTextPresenceFromState(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageId: string,
  textTransform?: MessageTextTransform,
): boolean {
  const message = readMessageFromState(state, sessionId, messageId, textTransform)
  return message?.parts.some(part => part.type === 'text' && part.text.length > 0) ?? false
}

function readPlainTextLengthFromState(
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

function readActiveStreamingSegmentKey(segments: ChatRenderSegment[]): string | null {
  const tail = segments.at(-1)
  if (!tail || (tail.kind !== 'text' && tail.kind !== 'reasoning')) {
    return null
  }
  return tail.key
}

function readActiveStreamingItemKey(items: ChatRenderItem[]): string | null {
  const tail = items.at(-1)
  if (!tail || (tail.kind !== 'text' && tail.kind !== 'reasoning')) {
    return null
  }
  return tail.key
}

function readToolApproval(
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

function ToolCallBlockFromPart({
  messageId,
  part,
  onToolApprovalResponse,
  children,
  animated,
  sessionId,
}: {
  messageId: string
  part: RenderableToolPart
  onToolApprovalResponse?: MessageBubbleProps['onToolApprovalResponse']
  children?: React.ReactNode
  animated?: boolean
  sessionId?: string | null
}) {
  const workspaceDiffTarget = useSessionLayoutStore(
    useShallow((state) => {
      if (!sessionId) {
        return undefined
      }
      const workspaceId = state.sessions[sessionId]?.workspaceId
      return workspaceId ? { workspaceId } : undefined
    }),
  )
  const approval = readToolApproval(part)

  return (
    <ToolCallBlock
      toolName={toolNameFromPart(part)}
      toolCallId={part.toolCallId}
      state={part.state}
      approval={approval}
      argumentsText={part.argumentsText}
      input={part.input}
      output={part.output}
      errorText={part.errorText}
      animated={animated}
      sessionId={sessionId}
      workspaceDiffTarget={workspaceDiffTarget}
      onApprovalResponse={
        approval && onToolApprovalResponse
          ? approval =>
              onToolApprovalResponse({
                messageId,
                approvalId: approval.id,
                approved: approval.approved,
              })
          : undefined
      }
    >
      {children}
    </ToolCallBlock>
  )
}

function ToolCallBlockByPartIndex({
  sessionId,
  messageId,
  partIndex,
  onToolApprovalResponse,
}: {
  sessionId: string
  messageId: string
  partIndex: number
  onToolApprovalResponse?: MessageBubbleProps['onToolApprovalResponse']
}) {
  const part = useChatStore(
    state => readRenderableToolPartFromState(state, sessionId, messageId, partIndex),
    areRenderableToolPartsEqual,
  )
  if (!part) {
    return null
  }
  return (
    <ToolCallBlockFromPart
      messageId={messageId}
      part={part}
      sessionId={sessionId}
      onToolApprovalResponse={onToolApprovalResponse}
    />
  )
}

function GroupedToolCallBlockFromParts({
  items,
  uiKind,
  animated,
  sessionId,
}: {
  items: Array<{ key: string, part: RenderableToolPart }>
  uiKind: ReturnType<typeof describeToolCall>['kind']
  animated?: boolean
  sessionId?: string | null
}) {
  const workspaceDiffTarget = useSessionLayoutStore(
    useShallow((state) => {
      if (!sessionId) {
        return undefined
      }
      const workspaceId = state.sessions[sessionId]?.workspaceId
      return workspaceId ? { workspaceId } : undefined
    }),
  )
  if (items.length === 0) {
    return null
  }

  return (
    <GroupedToolCallBlock
      items={items}
      uiKind={uiKind}
      animated={animated}
      workspaceDiffTarget={workspaceDiffTarget}
    />
  )
}

function GroupedToolCallBlockByPartIndexes({
  items,
  uiKind,
  sessionId,
}: {
  items: Array<{ key: string, messageId: string, partIndex: number }>
  uiKind: ReturnType<typeof describeToolCall>['kind']
  sessionId: string
}) {
  const parts = useChatStore(
    state =>
      items.flatMap((item) => {
        const part = readRenderableToolPartFromState(
          state,
          sessionId,
          item.messageId,
          item.partIndex,
        )
        return part ? [{ key: item.key, part }] : []
      }),
    areGroupedRenderableToolItemsEqual,
  )
  return <GroupedToolCallBlockFromParts items={parts} uiKind={uiKind} sessionId={sessionId} />
}

const MessageTextPartById = ({
  sessionId,
  messageId,
  partIndex,
  isUser,
  isActiveStreamingSegment,
  textTransform,
}: {
  sessionId: string
  messageId: string
  partIndex: number
  isUser: boolean
  isActiveStreamingSegment: boolean
  textTransform?: MessageTextTransform
}) => {
  const text = useChatStore(state =>
    readTextPartFromState(state, sessionId, messageId, partIndex, textTransform))
  const displayText = isUser ? readUserDisplayText(text) : text
  const animated = displayText.length <= MESSAGE_STREAMING_ANIMATION_MAX_CHARS

  if (isUser) {
    return <span className="whitespace-pre-wrap wrap-break-word">{displayText}</span>
  }

  return (
    <Streamdown
      content={displayText}
      streaming={isActiveStreamingSegment}
      animationPreset={STREAMDOWN_RENDER_OPTIONS.animationPreset}
      animateMode={STREAMDOWN_RENDER_OPTIONS.animateMode}
      showCursor={STREAMDOWN_RENDER_OPTIONS.showCursor}
      animated={animated}
      components={{
        a: props => <MarkdownFileLink {...readMarkdownAnchorProps(props)} sessionId={sessionId} />,
      }}
    />
  )
}
MessageTextPartById.displayName = 'MessageTextPartById'

const MessageReasoningPartById = ({
  sessionId,
  messageId,
  partIndex,
  isActiveStreamingSegment,
}: {
  sessionId: string
  messageId: string
  partIndex: number
  isActiveStreamingSegment: boolean
}) => {
  const part = useChatStore(
    state => readReasoningPartFromState(state, sessionId, messageId, partIndex),
    areReasoningPartsEqual,
  )
  const state = isActiveStreamingSegment && part.state === 'streaming' ? 'streaming' : 'done'

  return <ReasoningBlock text={part.text} state={state} />
}
MessageReasoningPartById.displayName = 'MessageReasoningPartById'

const MessageFilePartById = ({
  sessionId,
  messageId,
  partIndex,
  onImageClick,
}: {
  sessionId: string
  messageId: string
  partIndex: number
  onImageClick?: () => void
}) => {
  const part = useChatStore(state =>
    readFilePartFromState(state, sessionId, messageId, partIndex))
  if (!part) {
    return null
  }
  return <FileAttachmentBlock part={part} onClick={onImageClick} />
}
MessageFilePartById.displayName = 'MessageFilePartById'

const MessageSkillContextPartById = ({
  sessionId,
  messageId,
  partIndex,
}: {
  sessionId: string
  messageId: string
  partIndex: number
}) => {
  const part = useChatStore(state =>
    readSkillContextPartFromState(state, sessionId, messageId, partIndex))
  if (!part) {
    return null
  }
  return <SkillContextBlock part={part} />
}
MessageSkillContextPartById.displayName = 'MessageSkillContextPartById'

const MessagePluginContextPartById = ({
  sessionId,
  messageId,
  partIndex,
}: {
  sessionId: string
  messageId: string
  partIndex: number
}) => {
  const part = useChatStore(state =>
    readPluginContextPartFromState(state, sessionId, messageId, partIndex))
  if (!part) {
    return null
  }
  return <PluginContextBlock part={part} />
}
MessagePluginContextPartById.displayName = 'MessagePluginContextPartById'

const MessageThinkingPlaceholderById = ({
  sessionId,
  messageId,
  isAssistant,
  isStreaming,
  segmentCount,
  segments,
  textTransform,
  suppressPlaceholder,
}: {
  sessionId: string
  messageId: string
  isAssistant: boolean
  isStreaming: boolean
  segmentCount: number
  segments: ChatRenderSegment[]
  textTransform?: MessageTextTransform
  suppressPlaceholder?: boolean
}) => {
  const textLength = useChatStore(state =>
    readPlainTextLengthFromState(state, sessionId, messageId, textTransform))
  const hasActiveProgress = useChatStore(state =>
    hasActiveNonTextSegmentProgress(state, sessionId, messageId, segments))
  const streamTextIdle = useTextStreamIdle(isAssistant && isStreaming, textLength)

  if (
    !isAssistant
    || !isStreaming
    || suppressPlaceholder
    || hasActiveProgress
    || (segmentCount !== 0 && !streamTextIdle)
  ) {
    return null
  }

  return <ThinkingPlaceholder />
}
MessageThinkingPlaceholderById.displayName = 'MessageThinkingPlaceholderById'

const MessageCopyActionById = ({
  sessionId,
  messageId,
  isUser,
  editAction,
  textTransform,
}: {
  sessionId: string
  messageId: string
  isUser: boolean
  editAction?: MessageBubbleEditAction
  textTransform?: MessageTextTransform
}) => {
  const hasPlainText = useChatStore(state =>
    readPlainTextPresenceFromState(state, sessionId, messageId, textTransform))
  const [copied, setCopied] = useState(false)
  const copyFeedbackTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
    }
  }, [])

  const handleCopy = async () => {
    const plainText = readPlainTextFromState(useChatStore.getState(), sessionId, messageId, textTransform)
    await navigator.clipboard.writeText(plainText)
    setCopied(true)

    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
    }

    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopied(false)
      copyFeedbackTimerRef.current = null
    }, 1500)
  }

  if (!hasPlainText && !editAction) {
    return null
  }

  return (
    <div
      className={cn(
        'mt-1 flex items-center gap-0.5 opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 transition-[opacity,transform] duration-150',
        isUser && 'justify-end',
      )}
    >
      {editAction && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={editAction.disabled}
          onClick={editAction.onEdit}
          className="text-muted-foreground/50 hover:text-foreground"
          title={editAction.title}
          aria-label={editAction.label}
          data-testid="chat-edit-previous-btn"
        >
          {editAction.busy
            ? (
                <Spinner className="size-3.5" aria-hidden="true" />
              )
            : (
                <PencilIcon className="size-3.5" aria-hidden="true" />
              )}
        </Button>
      )}
      {hasPlainText && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={handleCopy}
          className="text-muted-foreground/50 hover:text-foreground"
          aria-label="Copy message"
        >
          {copied
            ? (
                <CheckIcon className="size-3.5 !text-emerald-500" aria-hidden="true" />
              )
            : (
                <CopyIcon className="size-3.5" aria-hidden="true" />
              )}
        </Button>
      )}
    </div>
  )
}
MessageCopyActionById.displayName = 'MessageCopyActionById'

const MessageSegmentView = ({
  segment,
  sessionId,
  isUser,
  isActiveStreamingSegment,
  onToolApprovalResponse,
  onImageClick,
  textTransform,
}: {
  segment: ChatRenderSegment
  sessionId: string
  isUser: boolean
  isActiveStreamingSegment: boolean
  onToolApprovalResponse?: MessageBubbleProps['onToolApprovalResponse']
  onImageClick?: () => void
  textTransform?: MessageTextTransform
}) => {
  switch (segment.kind) {
    case 'text':
      return (
        <MessageTextPartById
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
          isUser={isUser}
          isActiveStreamingSegment={isActiveStreamingSegment}
          textTransform={textTransform}
        />
      )
    case 'reasoning':
      return (
        <MessageReasoningPartById
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
          isActiveStreamingSegment={isActiveStreamingSegment}
        />
      )
    case 'tool-group':
      return (
        <GroupedToolCallBlockByPartIndexes
          items={segment.items}
          uiKind={segment.uiKind}
          sessionId={sessionId}
        />
      )
    case 'tool-call':
      return (
        <ToolCallBlockByPartIndex
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
          onToolApprovalResponse={onToolApprovalResponse}
        />
      )
    case 'file-attachment':
      return (
        <MessageFilePartById
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
          onImageClick={onImageClick}
        />
      )
    case 'skill-context':
      return (
        <MessageSkillContextPartById
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
        />
      )
    case 'plugin-context':
      return (
        <MessagePluginContextPartById
          sessionId={sessionId}
          messageId={segment.messageId}
          partIndex={segment.partIndex}
        />
      )
    default:
      return null
  }
}
MessageSegmentView.displayName = 'MessageSegmentView'

const MessageBubbleSegmentsView = ({
  sessionId,
  frame,
  segments,
  isStreaming,
  onToolApprovalResponse,
  editAction,
  textTransform,
}: {
  sessionId: string
  frame: MessageFrame
  segments: ChatRenderSegment[]
  isStreaming: boolean
  onToolApprovalResponse?: MessageBubbleProps['onToolApprovalResponse']
  editAction?: MessageBubbleEditAction
  textTransform?: MessageTextTransform
}) => {
  const isUser = frame.role === 'user'
  const isAssistant = frame.role === 'assistant'
  const activeStreamingSegmentKey = isStreaming && !frame.hasHiddenRuntimeUserInputTail
    ? readActiveStreamingSegmentKey(segments)
    : null
  const executionPhaseSplit = isStreaming
    ? null
    : splitSegmentExecutionPhase(segments, {
        describeToolKind: part => describeToolCall(part).kind,
      })

  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const imageSegments = (() => {
    return segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => {
        if (segment.kind !== 'file-attachment') {
          return false
        }
        const part = readFilePartFromState(
          useChatStore.getState(),
          sessionId,
          segment.messageId,
          segment.partIndex,
        )
        return part?.mediaType.startsWith('image/')
      })
  })()

  const lightboxImages = (() => {
    return imageSegments.map(({ segment }) => {
      if (segment.kind !== 'file-attachment') {
        return { url: '', alt: '' }
      }
      const part = readFilePartFromState(
        useChatStore.getState(),
        sessionId,
        segment.messageId,
        segment.partIndex,
      )
      return {
        url: part?.url ?? '',
        alt: part?.filename ?? part?.mediaType ?? 'Image',
      }
    })
  })()

  const handleImageClick = (segmentIndex: number) => {
    const imageIndex = imageSegments.findIndex(({ index }) => index === segmentIndex)
    if (imageIndex !== -1) {
      setLightboxIndex(imageIndex)
      setLightboxOpen(true)
    }
  }

  function renderSegment(segment: ChatRenderSegment, index: number) {
    return (
      <MessageSegmentView
        key={segment.key}
        segment={segment}
        sessionId={sessionId}
        isUser={isUser}
        isActiveStreamingSegment={segment.key === activeStreamingSegmentKey}
        onToolApprovalResponse={onToolApprovalResponse}
        onImageClick={
          segment.kind === 'file-attachment' ? () => handleImageClick(index) : undefined
        }
        textTransform={textTransform}
      />
    )
  }

  function renderSegmentsWithImageGrid(segs: ChatRenderSegment[]) {
    const result: React.ReactNode[] = []
    let imageBuffer: Array<{ segment: ChatRenderSegment, index: number }> = []

    segs.forEach((segment, index) => {
      const isImage
        = segment.kind === 'file-attachment'
          && (() => {
          if (segment.kind !== 'file-attachment') {
            return false
          }
          const part = readFilePartFromState(
            useChatStore.getState(),
            sessionId,
            segment.messageId,
            segment.partIndex,
          )
          return part?.mediaType.startsWith('image/')
        })()

      if (isImage) {
        imageBuffer.push({ segment, index })
      }
 else {
        if (imageBuffer.length > 0) {
          result.push(
            <div
              key={`image-grid-${imageBuffer[0].index}`}
              className="my-1 flex min-w-0 flex-wrap gap-2"
            >
              {imageBuffer.map(({ segment: imgSegment, index: imgIndex }) => (
                <div key={imgSegment.key} className={IMAGE_ATTACHMENT_GRID_ITEM_CLASS}>
                  {renderSegment(imgSegment, imgIndex)}
                </div>
              ))}
            </div>,
          )
          imageBuffer = []
        }
        result.push(renderSegment(segment, index))
      }
    })

    if (imageBuffer.length > 0) {
      result.push(
        <div
          key={`image-grid-${imageBuffer[0].index}`}
          className="my-1 flex min-w-0 flex-wrap gap-2"
        >
          {imageBuffer.map(({ segment: imgSegment, index: imgIndex }) => (
            <div key={imgSegment.key} className={IMAGE_ATTACHMENT_GRID_ITEM_CLASS}>
              {renderSegment(imgSegment, imgIndex)}
            </div>
          ))}
        </div>,
      )
    }

    return result
  }

  function renderContent() {
    if (frame.bangCommand) {
      return <BangCommandPromptBlock command={frame.bangCommand.command} />
    }

    if (frame.bangResult) {
      return <BangCommandBlock result={frame.bangResult} />
    }

    if (!executionPhaseSplit) {
      return renderSegmentsWithImageGrid(segments)
    }

    return (
      <>
        <ExecutionPhaseFold>
          {executionPhaseSplit.executionItems.map((segment, index) =>
            renderSegment(segment, index))}
        </ExecutionPhaseFold>
        {renderSegmentsWithImageGrid(executionPhaseSplit.finalItems)}
      </>
    )
  }

  return (
    <>
      <div
        // initial={isFirstAppearance ? { opacity: 0, y: 8 } : false}
        // animate={{ opacity: 1, y: 0 }}
        // transition={BUBBLE_TRANSITION}
        data-testid={`message-bubble-${frame.role}`}
        data-message-id={frame.id}
        data-message-role={frame.role}
        data-message-streaming={isStreaming ? 'true' : 'false'}
        className={cn('group flex w-full gap-3', isUser && 'justify-end')}
      >
        <div
          className={cn(
            'min-w-0',
            isUser
            && !frame.isSteerMessage
            && !frame.bangCommand
            && !frame.bangResult
            && 'max-w-[70%]',
            (frame.bangCommand || frame.bangResult) && 'max-w-[78%]',
            frame.isSteerMessage && STEER_MESSAGE_CONTAINER_CLASS,
            !isUser && 'w-full',
          )}
        >
          {frame.isSteerMessage && <SteerMessageLabel />}
          {frame.isGoalMessage && <GoalMessageLabel />}
          <div
            className={cn(
              'rounded-lg text-sm leading-relaxed',
              isUser
              && !frame.isSteerMessage
              && !frame.bangCommand
              && !frame.bangResult
              && 'bg-muted text-foreground rounded-br-sm px-3 py-2',
              (frame.bangCommand || frame.bangResult) && 'rounded-br-sm',
              frame.isSteerMessage && STEER_MESSAGE_BUBBLE_CLASS,
              isAssistant && 'text-foreground',
            )}
          >
            {renderContent()}
            <MessageThinkingPlaceholderById
              sessionId={sessionId}
              messageId={frame.id}
              isAssistant={isAssistant}
              isStreaming={isStreaming}
              segmentCount={segments.length}
              segments={segments}
              textTransform={textTransform}
              suppressPlaceholder={frame.hasHiddenRuntimeUserInputTail}
            />
          </div>

          {isAssistant && <RunDebugCaption messageId={frame.id} />}

          {!isStreaming && (
            <MessageCopyActionById
              sessionId={sessionId}
              messageId={frame.id}
              isUser={isUser}
              editAction={isUser ? editAction : undefined}
              textTransform={textTransform}
            />
          )}
        </div>
      </div>

      {lightboxImages.length > 0 && (
        <ImageLightbox
          images={lightboxImages}
          initialIndex={lightboxIndex}
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
        />
      )}
    </>
  )
}
MessageBubbleSegmentsView.displayName = 'MessageBubbleSegmentsView'

export const MessageBubbleById = ({
  sessionId,
  messageId,
  onToolApprovalResponse,
  editAction,
  textTransform,
}: {
  sessionId: string | null
  messageId: string
  onToolApprovalResponse?: MessageBubbleProps['onToolApprovalResponse']
  editAction?: MessageBubbleEditAction
  textTransform?: MessageTextTransform
}) => {
  const storeSessionId = sessionId ?? ''
  const frame = useChatStore(
    state => readMessageFrameFromState(state, storeSessionId, messageId, textTransform),
    areMessageFramesEqual,
  )
  const segments = useChatStore(
    state => readRenderSegmentsFromState(state, storeSessionId, messageId, textTransform),
    areRenderSegmentsEqual,
  )
  const isStreaming = useChatStore(
    chatSelectors.isVisibleStreamingMessage(storeSessionId, messageId),
    (a, b) => a === b,
  )

  if (!frame) {
    return null
  }

  return (
    <MessageBubbleSegmentsView
      sessionId={storeSessionId}
      frame={frame}
      segments={segments}
      isStreaming={isStreaming}
      onToolApprovalResponse={onToolApprovalResponse}
      editAction={editAction}
      textTransform={textTransform}
    />
  )
}
MessageBubbleById.displayName = 'MessageBubbleById'

function MessageBubbleView({
  message,
  isStreaming,
  executionDetailsDefaultOpen = false,
  presentation = 'thread',
  sessionId,
  onToolApprovalResponse,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isExportPresentation = presentation === 'export'
  const continuationMetadata = readChatContinuationMetadata(message)
  const isSteerMessage = isUser && continuationMetadata?.mode === 'steer'
  const isGoalMessage = isCodexGoalUserMessage(message)
  const bangCommand = isUser ? readBangCommandMetadata(message) : null
  const bangResult = isUser ? readBangResultMetadata(message) : null
  const [copied, setCopied] = useState(false)
  const copyFeedbackTimerRef = useRef<number | null>(null)

  const plainText = readMessageDisplayText(message)
  const plainTextLength = plainText.length
  const streamTextIdle = useTextStreamIdle(isAssistant && isStreaming, plainTextLength)

  const groupedItems = groupMessageParts({
    parts: message.parts,
    messageId: message.id,
    describeToolKind: part => describeToolCall(part).kind,
  })
  const activeStreamingItemKey = isStreaming ? readActiveStreamingItemKey(groupedItems) : null

  const executionPhaseSplit = isStreaming
    ? null
    : splitExecutionPhase(groupedItems, {
        describeToolKind: part => describeToolCall(part).kind,
      })
  const hasActiveProgress = hasActiveNonTextProgress(groupedItems)
  const showThinkingPlaceholder
    = isAssistant
      && isStreaming
      && !hasActiveProgress
      && (groupedItems.length === 0 || streamTextIdle)

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current)
      }
    }
  }, [])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(plainText)
    setCopied(true)

    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current)
    }

    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopied(false)
      copyFeedbackTimerRef.current = null
    }, 1500)
  }

  /* ─── Render items ─── */
  function renderItem(item: ChatRenderItem) {
    switch (item.kind) {
      case 'text':
        if (isUser) {
          const displayText = readUserDisplayText(item.text)
          return (
            <span key={item.key} className="whitespace-pre-wrap wrap-break-word">
              {displayText}
            </span>
          )
        }
        return (
          <Streamdown
            key={item.key}
            content={item.text}
            streaming={item.key === activeStreamingItemKey}
            animationPreset={STREAMDOWN_RENDER_OPTIONS.animationPreset}
            animateMode={STREAMDOWN_RENDER_OPTIONS.animateMode}
            showCursor={STREAMDOWN_RENDER_OPTIONS.showCursor}
            animated={item.text.length <= MESSAGE_STREAMING_ANIMATION_MAX_CHARS}
            components={{
              a: props => (
                <MarkdownFileLink {...readMarkdownAnchorProps(props)} sessionId={sessionId} />
              ),
            }}
          />
        )

      case 'reasoning':
        return (
          <ReasoningBlock
            key={item.key}
            text={item.text}
            state={
              item.key === activeStreamingItemKey && item.state === 'streaming'
                ? 'streaming'
                : 'done'
            }
          />
        )

      case 'tool-group':
        return (
          <GroupedToolCallBlockFromParts
            key={item.key}
            items={item.items}
            uiKind={item.uiKind}
            sessionId={sessionId}
          />
        )

      case 'tool-call':
        return (
          <ToolCallBlockFromPart
            key={item.key}
            messageId={message.id}
            part={item.part}
            sessionId={sessionId}
            onToolApprovalResponse={onToolApprovalResponse}
          />
        )

      case 'file-attachment':
        return <FileAttachmentBlock key={item.key} part={item.part} />

      case 'skill-context':
        return <SkillContextBlock key={item.key} part={item.part} />
      case 'plugin-context':
        return <PluginContextBlock key={item.key} part={item.part} />

      default:
        return null
    }
  }

  /* ─── Separate execution-phase items from final reply ─── */
  function renderContent() {
    if (bangCommand) {
      return <BangCommandPromptBlock command={bangCommand.command} />
    }

    if (bangResult) {
      return <BangCommandBlock result={bangResult} />
    }

    if (!executionPhaseSplit) {
      return groupedItems.map(renderItem)
    }

    if (isExportPresentation) {
      return executionPhaseSplit.finalItems.map(renderItem)
    }

    return (
      <>
        <ExecutionPhaseFold defaultOpen={executionDetailsDefaultOpen}>
          {executionPhaseSplit.executionItems.map(renderItem)}
        </ExecutionPhaseFold>
        {executionPhaseSplit.finalItems.map(renderItem)}
      </>
    )
  }

  return (
    <div
      // initial={!isExportPresentation && isFirstAppearance ? { opacity: 0, y: 8 } : false}
      // animate={{ opacity: 1, y: 0 }}
      // transition={BUBBLE_TRANSITION}
      data-testid={`message-bubble-${message.role}`}
      data-message-id={message.id}
      data-message-role={message.role}
      data-message-streaming={isStreaming ? 'true' : 'false'}
      className={cn('group flex w-full gap-3', isUser && 'justify-end')}
    >
      <div
        className={cn(
          'min-w-0',
          isUser && !isSteerMessage && !bangCommand && !bangResult && 'max-w-[70%]',
          (bangCommand || bangResult) && 'max-w-[78%]',
          isSteerMessage && STEER_MESSAGE_CONTAINER_CLASS,
          !isUser && 'w-full',
        )}
      >
        {isSteerMessage && <SteerMessageLabel />}
        {isGoalMessage && <GoalMessageLabel />}
        {/* Bubble */}
        <div
          className={cn(
            'rounded-lg text-sm leading-relaxed',
            isUser
            && !isSteerMessage
            && !bangCommand
            && !bangResult
            && 'bg-muted text-foreground rounded-br-sm px-3 py-2',
            (bangCommand || bangResult) && 'rounded-br-sm',
            isSteerMessage && STEER_MESSAGE_BUBBLE_CLASS,
            isAssistant && 'text-foreground',
          )}
        >
          {renderContent()}
          {showThinkingPlaceholder && <ThinkingPlaceholder />}
        </div>

        {isAssistant && <RunDebugCaption messageId={message.id} />}

        {/* Action bar — appears on hover for all messages */}
        {!isExportPresentation && !isStreaming && plainText.length > 0 && (
          <div
            className={cn(
              'mt-1 flex items-center gap-0.5 opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 transition-[opacity,transform] duration-150',
              isUser && 'justify-end',
            )}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleCopy}
              className="text-muted-foreground/50 hover:text-foreground"
              aria-label="Copy message"
            >
              {copied
? (
                <CheckIcon className="size-3.5 !text-emerald-500" aria-hidden="true" />
              )
: (
                <CopyIcon className="size-3.5" aria-hidden="true" />
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export const MessageBubble = MessageBubbleView
