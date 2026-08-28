import type { ReactNode } from 'react'
import { useMemo, useRef } from 'react'

import { useSessionBinding } from '../session/use-session-binding'
import { ActivityFeed } from '../tool-blocks/containers/activity-feed-container'
import { ToolCallBlock } from '../tool-blocks/containers/tool-call-block-container'
import type { ActivityFeedViewEntry } from '../tool-blocks/views/activity-feed-view'
import { useMessageDisplayParts, useMessagePartAt } from '../transcript/lib/message-display-parts-context'
import type { ActivityFeedEntryRef } from './chat-render-plan'
import { readRenderableToolPart } from './chat-render-plan'
import { useChatRenderStore } from './chat-render-store'
import { toolNameFromPart } from './chat-tool-entities'
import {
  areRenderableToolPartsEqual,
  readPartOverflowNotice,
  readReasoningPartFromState,
  readRenderableToolPartFromState,
  readToolApproval,
} from './message-bubble-selectors'
import { readReasoningDurationMs } from './reasoning-duration'
import type { RenderableToolPart } from './tool-ui-classifier'

export type MessageToolApprovalHandler = (response: {
  messageId: string
  approvalId: string
  approved: boolean
  selectedOptionId?: string
}) => void

export function ToolCallBlockFromPart({
  messageId,
  part,
  onToolApprovalResponse,
  children,
  animated,
  autoOpenArtifact,
  sessionId,
  workspaceDiffTarget,
}: {
  messageId: string
  part: RenderableToolPart
  onToolApprovalResponse?: MessageToolApprovalHandler
  children?: ReactNode
  animated?: boolean
  autoOpenArtifact?: boolean
  sessionId?: string | null
  workspaceDiffTarget?: { workspaceId: string, ownerId?: string | null }
}) {
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
      autoOpenArtifact={autoOpenArtifact}
      sessionId={sessionId}
      workspaceDiffTarget={workspaceDiffTarget}
      onApprovalResponse={
        approval && onToolApprovalResponse
          ? approvalResponse =>
              onToolApprovalResponse({
                messageId,
                approvalId: approvalResponse.id,
                approved: approvalResponse.approved,
                selectedOptionId: approvalResponse.selectedOptionId,
              })
          : undefined
      }
    >
      {children}
    </ToolCallBlock>
  )
}

export function ToolCallBlockByPartIndex({
  sessionId,
  messageId,
  partIndex,
  onToolApprovalResponse,
  autoOpenArtifact,
}: {
  sessionId: string
  messageId: string
  partIndex: number
  onToolApprovalResponse?: MessageToolApprovalHandler
  autoOpenArtifact?: boolean
}) {
  const workspaceId = useSessionBinding(sessionId, true)?.workspaceId ?? null
  const workspaceDiffTarget = useMemo(
    () => workspaceId ? { workspaceId } : undefined,
    [workspaceId],
  )
  const displayPart = useMessagePartAt(partIndex)
  const storePart = useChatRenderStore(
    (state) => {
      if (displayPart !== undefined) {
        return null
      }
      return readRenderableToolPartFromState(state, sessionId, messageId, partIndex)
    },
    areRenderableToolPartsEqual,
  )
  const part = displayPart !== undefined
    ? (displayPart ? readRenderableToolPart(displayPart) : null)
    : storePart
  if (!part) {
    return null
  }
  return (
    <ToolCallBlockFromPart
      messageId={messageId}
      part={part}
      sessionId={sessionId}
      workspaceDiffTarget={workspaceDiffTarget}
      onToolApprovalResponse={onToolApprovalResponse}
      autoOpenArtifact={autoOpenArtifact}
    />
  )
}

function areResolvedFeedEntriesEqual(
  left: Array<ActivityFeedViewEntry | null>,
  right: Array<ActivityFeedViewEntry | null>,
): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  for (let i = 0; i < left.length; i++) {
    const l = left[i]
    const r = right[i]
    if (l === null || r === null) {
      if (l !== r) {
        return false
      }
      continue
    }
    if (l.entryKind !== r.entryKind || l.key !== r.key) {
      return false
    }
    if (l.entryKind === 'tool-call' && r.entryKind === 'tool-call' && l.part !== r.part) {
      return false
    }
    if (
      l.entryKind === 'reasoning'
      && r.entryKind === 'reasoning'
      && (l.text !== r.text || l.state !== r.state)
    ) {
      return false
    }
  }
  return true
}

export function ActivityFeedFromParts({
  entries,
  animated,
  workspaceDiffTarget,
  sessionId,
}: {
  entries: ActivityFeedViewEntry[]
  animated?: boolean
  workspaceDiffTarget?: { workspaceId: string, ownerId?: string | null }
  sessionId?: string | null
}) {
  const sessionWorkspaceId = useSessionBinding(sessionId ?? '', Boolean(sessionId))?.workspaceId ?? null
  const resolvedWorkspaceDiffTarget = workspaceDiffTarget
    ?? (sessionWorkspaceId ? { workspaceId: sessionWorkspaceId } : undefined)
  // Stable object identity per reasoning entry so duration tracking survives re-renders.
  const reasoningPartCacheRef = useRef(new Map<string, { text: string, state?: 'streaming' | 'done' }>())

  if (entries.length === 0) {
    return null
  }

  const resolvedEntries = entries.map((entry) => {
    if (entry.entryKind !== 'reasoning') {
      return entry
    }
    const cache = reasoningPartCacheRef.current
    let cached = cache.get(entry.key)
    if (!cached) {
      cached = { text: entry.text, state: entry.state }
      cache.set(entry.key, cached)
    }
 else {
      cached.text = entry.text
      cached.state = entry.state
    }
    return { ...entry, durationMs: entry.durationMs ?? readReasoningDurationMs(cached) }
  })

  return (
    <ActivityFeed
      entries={resolvedEntries}
      animated={animated}
      sessionId={sessionId}
      workspaceDiffTarget={resolvedWorkspaceDiffTarget}
    />
  )
}

export function ActivityFeedByPartIndexes({
  entries,
  sessionId,
}: {
  entries: ActivityFeedEntryRef[]
  sessionId: string
}) {
  const workspaceId = useSessionBinding(sessionId, true)?.workspaceId ?? null
  const workspaceDiffTarget = useMemo(
    () => workspaceId ? { workspaceId } : undefined,
    [workspaceId],
  )
  const displayParts = useMessageDisplayParts()
  const storeEntries = useChatRenderStore(
    (state) => {
      if (displayParts) {
        return []
      }
      return entries.map((entry): ActivityFeedViewEntry | null => {
        if (entry.entryKind === 'reasoning') {
          const part = readReasoningPartFromState(state, sessionId, entry.messageId, entry.partIndex)
          return {
            entryKind: 'reasoning',
            key: entry.key,
            text: part.text,
            state: part.state,
            overflowOriginalChars: part.overflow?.originalChars ?? null,
            overflowBlobId: part.overflow?.blobId ?? null,
          }
        }
        const part = readRenderableToolPartFromState(state, sessionId, entry.messageId, entry.partIndex)
        return part ? { entryKind: 'tool-call', key: entry.key, part } : null
      })
    },
    areResolvedFeedEntriesEqual,
  )
  const resolvedEntries: ActivityFeedViewEntry[] = displayParts
    ? entries.flatMap((entry): ActivityFeedViewEntry[] => {
        const part = displayParts[entry.partIndex]
        if (entry.entryKind === 'reasoning') {
          if (part?.type !== 'reasoning') {
            return []
          }
          const overflow = readPartOverflowNotice(part)
          return [{
            entryKind: 'reasoning',
            key: entry.key,
            text: part.text,
            state: (part as { state?: 'streaming' | 'done' }).state,
            overflowOriginalChars: overflow?.originalChars ?? null,
            overflowBlobId: overflow?.blobId ?? null,
          }]
        }
        const toolPart = part ? readRenderableToolPart(part) : null
        return toolPart ? [{ entryKind: 'tool-call', key: entry.key, part: toolPart }] : []
      })
    : storeEntries.filter((entry): entry is ActivityFeedViewEntry => entry !== null)

  return (
    <ActivityFeedFromParts
      entries={resolvedEntries}
      sessionId={sessionId}
      workspaceDiffTarget={workspaceDiffTarget}
    />
  )
}
